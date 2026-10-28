import { PgBoss } from "pg-boss";
import { afterAll, describe, expect, it } from "vitest";
import { QUEUES } from "@/core/contracts";
import { testDatabaseUrl } from "@/test/db-url";
import { ensureQueues, JOB_EXPIRY_SECONDS } from "./queue";

const boss = new PgBoss(testDatabaseUrl());
afterAll(() => boss.stop({ graceful: false }));

describe("ensureQueues", () => {
  it("gives sync and author jobs room to finish, also on a queue created with the old default", async () => {
    await boss.start();
    await boss.deleteQueue(QUEUES.authorWiki).catch(() => {});
    await boss.createQueue(QUEUES.authorWiki, { policy: "stately" }); // as an older install left it: 900s

    await ensureQueues(boss);

    expect((await boss.getQueue(QUEUES.authorWiki))?.expireInSeconds).toBe(JOB_EXPIRY_SECONDS[QUEUES.authorWiki]);
    expect((await boss.getQueue(QUEUES.syncRepo))?.expireInSeconds).toBe(JOB_EXPIRY_SECONDS[QUEUES.syncRepo]);
    expect(JOB_EXPIRY_SECONDS[QUEUES.authorWiki]).toBeGreaterThan(900);
  });
});
