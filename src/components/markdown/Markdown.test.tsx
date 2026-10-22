// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Markdown } from "./Markdown";
import { normalizeAdoMarkdown } from "./plugins";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

afterEach(cleanup);

const ID = "3f2b9c1e-8a4d-4c2e-9b1a-0d5e6f7a8b9c";
const hrefs = (c: HTMLElement) => [...c.querySelectorAll("a")].map((a) => a.getAttribute("href"));

describe("Markdown", () => {
  it("strips javascript: and other non-http schemes", () => {
    const { container } = render(
      <Markdown>{"[x](javascript:alert(1)) [y](data:text/html,hi) [z](vbscript:x) [m](mailto:a@b.c)"}</Markdown>,
    );
    expect(hrefs(container).filter(Boolean)).toEqual([]);
  });

  it("turns source: citations into GitHub permalinks opening in a new tab", () => {
    const { container } = render(<Markdown>{"[a.ts#L1-L3](source:acme/api/src/a.ts#L1-L3@abc1234)"}</Markdown>);
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://github.com/acme/api/blob/abc1234/src/a.ts#L1-L3");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("resolves wiki: links through the path map, marks dead ones, and falls back to /page/<id>", () => {
    const md = `[ok](wiki:${ID}) [dead](wiki:00000000-0000-4000-8000-000000000000)`;
    const withMap = render(<Markdown wikiPaths={{ [ID]: "Architecture/Ingest Jobs" }}>{md}</Markdown>);
    expect(hrefs(withMap.container)).toEqual(["/wiki/Architecture/Ingest%20Jobs"]);
    expect(withMap.getByTitle("Link to a missing page").textContent).toBe("dead");
    cleanup();
    const chat = render(<Markdown>{`[ok](wiki:${ID})`}</Markdown>);
    expect(hrefs(chat.container)).toEqual([`/page/${ID}`]);
  });

  it("never renders raw HTML", () => {
    const { container } = render(
      <Markdown>{'<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n<b>bold</b>'}</Markdown>,
    );
    expect(container.querySelector("script, img, b")).toBeNull();
  });

  it("renders [[_TOC_]] as links to the headings' ids", () => {
    const { container } = render(<Markdown>{"[[_TOC_]]\n\n# Intro\n\n## Set up\n\n## Set up"}</Markdown>);
    const toc = container.querySelector("nav.toc")!;
    expect(hrefs(toc as HTMLElement)).toEqual(["#user-content-intro", "#user-content-set-up", "#user-content-set-up-1"]);
    expect(container.querySelector("#user-content-set-up-1")?.tagName).toBe("H2");
  });

  it("converts ADO ::: mermaid blocks to fenced mermaid", () => {
    expect(normalizeAdoMarkdown("a\n::: mermaid\ngraph TD\n A-->B\n:::\nb")).toBe("a\n```mermaid\ngraph TD\n A-->B\n```\nb");
  });
});
