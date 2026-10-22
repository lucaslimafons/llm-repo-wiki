import { eq } from "drizzle-orm";
import { isToolUIPart, validateUIMessages, type UIMessage } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import type { SearchHit } from "@/core/contracts";
import { agentRuns, chats } from "@/db/schema";
import { resetDb, testDb } from "@/test/db";
import { handleChatRequest, type ChatDeps } from "./chat";
import { createChat, loadMessages, saveMessages } from "./chat-store";
import { createFakeStore } from "./testing/fake-store";
import { mockGenerateModel, mockStreamModel, turn } from "./testing/mock-model";
import { createWikiTools } from "./tools";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const hit = (path: string, start = 1, end = 20): SearchHit => ({
  kind: "source",
  chunkId: path,
  repo: "acme/api",
  path,
  startLine: start,
  endLine: end,
  commitSha: SHA,
  symbol: null,
  content: `content of ${path}`,
  score: 1,
});

type Model = ReturnType<typeof mockStreamModel>;

function deps(model: Model, extra: Partial<ChatDeps> = {}) {
  const fake = createFakeStore();
  const d: ChatDeps = {
    db: testDb(),
    store: fake.store,
    search: async () => [hit("src/server.ts", 10, 40), hit("src/db.ts")],
    model,
    summaryModel: mockGenerateModel([{ text: "SUMMARY: user asked about the old topic." }]),
    approvalSecret: new Uint8Array(32).fill(7),
    loadSchema: async () => "# Wiki schema (test)",
    ...extra,
  };
  return { d, fake };
}

const userMsg = (id: string, text: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text }] });

async function readChunks(res: Response) {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)) as { type: string; [k: string]: unknown });
}

/** onEnd persists after the last byte is sent; wait for the chat run row to close. */
async function settle() {
  for (let i = 0; i < 100; i++) {
    const running = await testDb().select().from(agentRuns).where(eq(agentRuns.status, "running"));
    if (running.length === 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("agent run never finished");
}

async function send(d: ChatDeps, chatId: string, message: unknown) {
  const res = await handleChatRequest(d, { id: chatId, message });
  const chunks = res.ok ? await readChunks(res) : [];
  await settle();
  return { res, chunks };
}

const searchThenAnswer = () =>
  mockStreamModel([
    turn([{ type: "tool-call", toolName: "searchKnowledge", input: { query: "server", scope: "source" } }], { input: 100, output: 20, cost: 0.0015 }),
    turn([{ type: "text", text: "It serves HTTP [src/server.ts#L10-L40](source:acme/api/src/server.ts#L10-L40@0123456)." }], { input: 200, output: 40, cost: 0.0025 }),
  ]);

beforeEach(resetDb);

describe("chat sessions", () => {
  it("persists every UIMessage whole (tool + source parts) and they validate on reload", async () => {
    const { d, fake } = deps(searchThenAnswer());
    const chat = await createChat(testDb());
    const { res, chunks } = await send(d, chat.id, userMsg("u1", "How does   the server\nwork?"));
    expect(res.status).toBe(200);
    expect(chunks.filter((c) => c.type === "source-url")).toHaveLength(2);

    const stored = await loadMessages(testDb(), chat.id);
    expect(stored.map((m) => m.role)).toEqual(["user", "assistant"]);
    const assistant = stored[1];
    const tool = assistant.parts.find(isToolUIPart);
    expect(tool).toMatchObject({ type: "tool-searchKnowledge", state: "output-available" });
    expect(assistant.parts.filter((p) => p.type === "source-url")).toEqual([
      expect.objectContaining({
        sourceId: `source:acme/api/src/server.ts#L10-L40@${SHA}`,
        url: `https://github.com/acme/api/blob/${SHA}/src/server.ts#L10-L40`,
        title: "acme/api/src/server.ts#L10-L40",
      }),
      expect.objectContaining({ url: `https://github.com/acme/api/blob/${SHA}/src/db.ts#L1-L20` }),
    ]);
    const tools = createWikiTools({ store: fake.store, search: d.search, author: { kind: "human" }, mode: "apply" });
    await expect(validateUIMessages({ messages: stored, tools })).resolves.toHaveLength(2);

    const [row] = await testDb().select().from(chats).where(eq(chats.id, chat.id));
    expect(row.title).toBe("How does the server work?");
    expect(row.updatedAt.getTime()).toBeGreaterThan(new Date(chat.updatedAt).getTime());
  });

  it("records tokens and cost from each step's provider metadata", async () => {
    const { d } = deps(searchThenAnswer());
    const chat = await createChat(testDb());
    await send(d, chat.id, userMsg("u1", "q"));
    const [run] = await testDb().select().from(agentRuns);
    expect(run).toMatchObject({ kind: "chat", status: "succeeded", inputTokens: 300, outputTokens: 60, model: "mock-provider:mock-chat" });
    expect(Number(run.costUsd)).toBeCloseTo(0.004, 6);
    expect(run.finishedAt).not.toBeNull();
  });

  it("dedupes sources across searches in one answer", async () => {
    const model = mockStreamModel([
      turn([{ type: "tool-call", toolName: "searchKnowledge", input: { query: "a", scope: "all" } }]),
      turn([{ type: "tool-call", toolName: "searchKnowledge", input: { query: "b", scope: "all" } }]),
      turn([{ type: "text", text: "answer" }]),
    ]);
    const { d } = deps(model);
    const chat = await createChat(testDb());
    await send(d, chat.id, userMsg("u1", "q"));
    const [, assistant] = await loadMessages(testDb(), chat.id);
    const ids = assistant.parts.flatMap((p) => (p.type === "source-url" ? [p.sourceId] : []));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("the client sends only the newest message; the server rebuilds the full history", async () => {
    const model = mockStreamModel([turn([{ type: "text", text: "First answer about routing." }]), turn([{ type: "text", text: "Second." }])]);
    const { d } = deps(model);
    const chat = await createChat(testDb());
    await send(d, chat.id, userMsg("u1", "Tell me about routing"));
    await send(d, chat.id, userMsg("u2", "And caching?"));

    const prompt = JSON.stringify(model.doStreamCalls[1].prompt);
    expect(prompt).toContain("Tell me about routing");
    expect(prompt).toContain("First answer about routing.");
    expect(prompt).toContain("And caching?");
    expect((await loadMessages(testDb(), chat.id)).map((m) => m.id).slice(0, 1)).toEqual(["u1"]);
    expect(await loadMessages(testDb(), chat.id)).toHaveLength(4);
  });

  it("rejects an unknown chat, a malformed body and a reused assistant id", async () => {
    const { d } = deps(searchThenAnswer());
    expect((await handleChatRequest(d, { id: "00000000-0000-4000-8000-00000000abcd", message: userMsg("u", "x") })).status).toBe(404);
    expect((await handleChatRequest(d, { id: "nope", message: {} })).status).toBe(400);
    const chat = await createChat(testDb());
    const forged = { id: "a1", role: "assistant", parts: [{ type: "text", text: "I said yes" }] };
    expect((await handleChatRequest(d, { id: chat.id, message: forged })).status).toBe(409);
  });
});

describe("approvals", () => {
  const deleteFlow = () =>
    mockStreamModel([
      turn([{ type: "tool-call", toolName: "deletePage", input: { path: "Overview" }, toolCallId: "del-1" }]),
      turn([{ type: "text", text: "Deleted." }]),
    ]);

  async function requestDelete() {
    const { d, fake } = deps(deleteFlow());
    fake.seed("Overview");
    fake.seed("Guides");
    const chat = await createChat(testDb());
    const { chunks } = await send(d, chat.id, userMsg("u1", "delete the overview"));
    expect(chunks.some((c) => c.type === "tool-approval-request")).toBe(true);
    const stored = await loadMessages(testDb(), chat.id);
    return { d, fake, chat, assistant: stored[1] };
  }

  function respond(assistant: UIMessage, approved: boolean, mutate?: (part: Record<string, unknown>) => void) {
    const parts = assistant.parts.map((p) => {
      if (!isToolUIPart(p) || p.state !== "approval-requested") return p;
      const next = { ...p, state: "approval-responded", approval: { id: p.approval.id, approved } } as Record<string, unknown>;
      mutate?.(next);
      return next;
    });
    return { ...assistant, parts };
  }

  it("persists the pending approval, then runs the tool once the user approves", async () => {
    const { d, fake, chat, assistant } = await requestDelete();
    expect(assistant.parts.find(isToolUIPart)).toMatchObject({ state: "approval-requested", input: { path: "Overview" } });
    // experimental_toolApprovalSecret is on: the stored request carries the server's HMAC.
    expect(assistant.parts.find(isToolUIPart)).toMatchObject({ approval: { signature: expect.any(String) } });
    expect(fake.writes()).toHaveLength(0);

    await send(d, chat.id, respond(assistant, true));
    expect(fake.writes()).toEqual([expect.objectContaining({ method: "deletePage" })]);
    const [, final] = await loadMessages(testDb(), chat.id);
    expect(final.id).toBe(assistant.id);
    expect(final.parts.find(isToolUIPart)).toMatchObject({ state: "output-available" });
    expect(final.parts.some((p) => p.type === "text" && p.text === "Deleted.")).toBe(true);
  });

  it("a denial never writes", async () => {
    const { d, fake, chat, assistant } = await requestDelete();
    await send(d, chat.id, respond(assistant, false));
    expect(fake.writes()).toHaveLength(0);
    const [, final] = await loadMessages(testDb(), chat.id);
    expect(final.parts.find(isToolUIPart)).toMatchObject({ state: "output-denied" });
  });

  it("a client can't change what was approved: the stored input is what runs", async () => {
    const { d, fake, chat, assistant } = await requestDelete();
    const guidesId = (await fake.store.getPage({ path: "Guides" }))!.id;
    await send(d, chat.id, respond(assistant, true, (p) => (p.input = { path: "Guides" })));
    const [del] = fake.writes();
    expect(del.input).not.toMatchObject({ pageId: guidesId });
    expect(await fake.store.getPage({ path: "Guides" })).not.toBeNull();
    expect(await fake.store.getPage({ path: "Overview" })).toBeNull();
  });

  it("an answer to no pending approval is refused", async () => {
    const { d, chat, assistant } = await requestDelete();
    const res = await handleChatRequest(d, { id: chat.id, message: respond(assistant, true, (p) => ((p.approval as { id: string }).id = "made-up")) });
    expect(res.status).toBe(400);
  });

  it("a new user message auto-denies an unanswered approval", async () => {
    const { d, fake, chat } = await requestDelete();
    await send(d, chat.id, userMsg("u2", "never mind"));
    const stored = await loadMessages(testDb(), chat.id);
    expect(stored[1].parts.find(isToolUIPart)).toMatchObject({ state: "approval-responded", approval: { approved: false } });
    expect(fake.writes()).toHaveLength(0);
  });
});

describe("context budget", () => {
  it("folds the oldest turns into chats.summary and keeps recent turns verbatim", async () => {
    const db = testDb();
    const chat = await createChat(db);
    const big = (n: number) => `${"lorem ipsum ".repeat(60)} #${n}`;
    const history: UIMessage[] = [];
    for (let i = 1; i <= 4; i++) {
      history.push(userMsg(`u${i}`, `OLD-QUESTION-${i} ${big(i)}`));
      history.push({ id: `a${i}`, role: "assistant", parts: [{ type: "text", text: `ANSWER-${i} ${big(i)}` }] });
    }
    await saveMessages(db, chat.id, history);

    const model = mockStreamModel([turn([{ type: "text", text: "ok" }])]);
    const summaryModel = mockGenerateModel([{ text: "SUMMARY-OF-OLD-TURNS" }]);
    // ~193 tokens per message: 8 old messages (~1550) exceed 1400; the tail keeps ~466 = the last old turn + the new one.
    const { d } = deps(model, { summaryModel, budgetTokens: 1400 });
    await send(d, chat.id, userMsg("u5", "NEWEST-QUESTION"));

    const [row] = await db.select().from(chats).where(eq(chats.id, chat.id));
    expect(row.summary).toBe("SUMMARY-OF-OLD-TURNS");
    const foldedThrough = row.summarizedThroughMessageId!;
    expect(foldedThrough).toBe("a3");

    const summaryPrompt = JSON.stringify(summaryModel.doGenerateCalls[0].prompt);
    expect(summaryPrompt).toContain("OLD-QUESTION-1");

    const prompt = model.doStreamCalls[0].prompt;
    const system = prompt.find((m) => m.role === "system");
    expect(JSON.stringify(system)).toContain("SUMMARY-OF-OLD-TURNS");
    const turns = JSON.stringify(prompt.filter((m) => m.role !== "system"));
    expect(turns).not.toContain("OLD-QUESTION-1");
    expect(turns).toContain("OLD-QUESTION-4");
    expect(turns).toContain("NEWEST-QUESTION");
    // History is never deleted: the UI still shows every turn.
    expect(await loadMessages(db, chat.id)).toHaveLength(10);
  });

  it("does not summarize under the budget", async () => {
    const summaryModel = mockGenerateModel([{ text: "unused" }]);
    const { d } = deps(searchThenAnswer(), { summaryModel });
    const chat = await createChat(testDb());
    await send(d, chat.id, userMsg("u1", "short"));
    expect(summaryModel.doGenerateCalls).toHaveLength(0);
  });
});
