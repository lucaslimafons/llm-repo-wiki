import type { PgBoss } from "pg-boss";

/** Track-owned: register this track's pg-boss workers and schedules. */
export async function registerAgentJobs(_boss: PgBoss): Promise<void> {}
