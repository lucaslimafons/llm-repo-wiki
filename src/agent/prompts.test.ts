import { describe, expect, it } from "vitest";
import { buildAuthorInstructions, buildChatInstructions } from "./prompts";

const PROJECT = "## Project context (written by the wiki owner)\n\nOne recipe product.";

describe("prompt builders", () => {
  it("give both agents the owner's project context, before the schema", () => {
    const chat = buildChatInstructions({ schema: "# schema", tree: [], summary: null, project: PROJECT });
    const author = buildAuthorInstructions({ schema: "# schema", repo: "acme/api", sha: "abc", project: PROJECT });
    for (const text of [chat, author]) {
      expect(text).toContain("One recipe product.");
      expect(text.indexOf("Project context")).toBeLessThan(text.indexOf("## Wiki schema"));
    }
  });

  it("leave the section out when there is no context", () => {
    expect(buildChatInstructions({ schema: "# schema", tree: [], summary: null, project: null })).not.toContain("Project context");
    expect(buildAuthorInstructions({ schema: "# schema", repo: "acme/api", sha: "abc" })).not.toContain("Project context");
  });
});
