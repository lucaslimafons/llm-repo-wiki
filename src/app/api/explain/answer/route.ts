import { explainAnswer, explainAnswerInputSchema } from "@/agent/explain-answer";
import { chatModel } from "@/agent/models";
import { db } from "@/db/client";

/** One answer over the chunks the reader is looking at, then the grounding check on it. */
export async function POST(req: Request): Promise<Response> {
  const parsed = explainAnswerInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid request" }, { status: 400 });
  try {
    return Response.json(await explainAnswer(parsed.data, { db: db(), model: chatModel() }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "answer failed" }, { status: 500 });
  }
}
