import { describe, expect, it } from "vitest";
import { z } from "zod";
import { describeIssues } from "./zod-issues";

describe("describeIssues", () => {
  it("names each failing field with its message", () => {
    const r = z.object({ query: z.string().min(1, "Type a question."), keys: z.array(z.string()).min(1) }).safeParse({ query: "", keys: [] });
    expect(r.success).toBe(false);
    expect(describeIssues(r.error!)).toBe("query: Type a question.; keys: Too small: expected array to have >=1 items");
  });
});
