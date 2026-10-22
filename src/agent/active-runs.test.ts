import { describe, expect, it } from "vitest";
import { beginRun, endRun, stopRun } from "./active-runs";

describe("active chat runs", () => {
  it("stop aborts the run and forgets it", () => {
    const c = beginRun("chat-1");
    expect(stopRun("chat-1")).toBe(true);
    expect(c.signal.aborted).toBe(true);
    expect(stopRun("chat-1")).toBe(false);
  });

  it("a newer run for the same chat supersedes the older one", () => {
    const first = beginRun("chat-2");
    const second = beginRun("chat-2");
    expect(first.signal.aborted).toBe(true);
    endRun("chat-2", first);
    expect(stopRun("chat-2")).toBe(true);
    expect(second.signal.aborted).toBe(true);
  });
});
