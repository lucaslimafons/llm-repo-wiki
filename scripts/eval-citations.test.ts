import { describe, expect, it } from "vitest";
import { cohensKappa, excerpt, extractClaims, mulberry32, plantDecoys, quoteFound, summarize, type Judgment, type Pair } from "./eval-citations";

const sha = "382d29c485e67018c06e75ec7235130d0968522c";
const src = (path: string, a: number, b: number) => `[${path.split("/").pop()}#L${a}-L${b}](source:acme/lib/${path}#L${a}-L${b}@${sha})`;

const body = [
  "# Persisting State",
  "",
  `The middleware stores state across reloads ${src("docs/persist.md", 7, 10)}. The \`name\` is the storage key ${src("README.md", 307, 307)}.`,
  "An uncited sentence stays out.",
  "",
  "## Setup",
  "",
  `- Wrap the creator in \`persist\` ${src("README.md", 296, 311)}.`,
  `- Pass a storage ${src("README.md", 308, 308)} ${src("README.md", 308, 308)}.`,
  `- Equality works like \`create\` (${src("src/traditional.ts", 1, 9)}).`,
  "",
  "```ts",
  `const x = 1 // ${src("src/x.ts", 1, 2)}`,
  "```",
  "",
  `> Unverified: the FAQ covers hydration ${src("docs/faq.md", 580, 580)}, but it was not retrieved.`,
].join("\n");

describe("extractClaims", () => {
  const claims = extractClaims("Persist", body);

  it("keeps one claim per cited sentence, with its section, and strips the links", () => {
    expect(claims.map((c) => [c.heading, c.text])).toEqual([
      ["Persisting State", "The middleware stores state across reloads."],
      ["Persisting State", "The `name` is the storage key."],
      ["Setup", "Wrap the creator in `persist`."],
      ["Setup", "Pass a storage."],
      ["Setup", "Equality works like `create`."],
    ]);
  });

  it("does not split on the dot inside a cited filename", () => {
    expect(claims[0].citations).toMatchObject([{ path: "docs/persist.md", startLine: 7, endLine: 10 }]);
  });

  it("dedupes a source cited twice in one sentence", () => {
    expect(claims[3].citations).toHaveLength(1);
  });

  it("skips code fences and Unverified callouts", () => {
    expect(claims.flatMap((c) => c.citations.map((x) => x.path))).not.toContain("src/x.ts");
    expect(claims.flatMap((c) => c.citations.map((x) => x.path))).not.toContain("docs/faq.md");
  });
});

describe("plantDecoys", () => {
  const claims = extractClaims("Persist", body);

  it("keeps every real claim and adds planted copies whose citation overlaps none of the original", () => {
    const pairs = plantDecoys(claims, 1, mulberry32(1));
    const real = pairs.filter((p) => !p.planted);
    const planted = pairs.filter((p) => p.planted);
    expect(real).toHaveLength(claims.length);
    expect(planted.length).toBeGreaterThan(0);
    for (const p of planted) {
      if (!p.planted) continue;
      const [d] = p.citations;
      for (const o of p.original) {
        const overlap = d.path === o.path && d.startLine! <= o.endLine! && o.startLine! <= d.endLine!;
        expect(overlap).toBe(false);
      }
      expect(p.decoy).toBe(p.original.some((o) => o.path === d.path) ? "same-file" : "other-file");
    }
  });

  it("is reproducible from the seed and plants nothing at rate 0", () => {
    expect(plantDecoys(claims, 0.5, mulberry32(7))).toEqual(plantDecoys(claims, 0.5, mulberry32(7)));
    expect(plantDecoys(claims, 0, mulberry32(7)).every((p) => !p.planted)).toBe(true);
  });
});

describe("excerpt and quoteFound", () => {
  const file = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`);

  it("numbers the cited lines and cuts long ranges", () => {
    expect(excerpt(file, { repo: "acme/lib", path: "a", commitSha: sha, startLine: 2, endLine: 3 })).toEqual({ text: "2: line 2\n3: line 3", truncated: false });
    expect(excerpt(file, { repo: "acme/lib", path: "a", commitSha: sha, startLine: 1, endLine: 300 }).truncated).toBe(true);
  });

  it("accepts a verbatim quote, with or without line numbers, and rejects an invented one", () => {
    const ex = "10:   const next = typeof partial === 'function'\n11:     ? partial(state)";
    expect(quoteFound("const next = typeof partial === 'function'", ex)).toBe(true);
    expect(quoteFound("10: const next = typeof partial === 'function'\n11: ? partial(state)", ex)).toBe(true);
    expect(quoteFound("state is replaced", ex)).toBe(false);
    expect(quoteFound("", ex)).toBe(false);
  });
});

describe("cohensKappa", () => {
  it("is 1 for full agreement and 0 or less for chance-level agreement", () => {
    expect(cohensKappa(["supported", "unsupported"], ["supported", "unsupported"])).toBe(1);
    expect(cohensKappa(["supported", "supported", "unsupported", "unsupported"], ["supported", "unsupported", "supported", "unsupported"])).toBe(0);
  });
});

describe("summarize", () => {
  const claim = { page: "P", heading: "H", text: "t", citations: [] };
  const pairs: Pair[] = [
    { ...claim, id: "a", planted: false },
    { ...claim, id: "b", planted: false },
    { ...claim, id: "c", planted: true, decoy: "other-file", original: [] },
  ];
  const j = (judge: string, pairId: string, verdict: Judgment["verdict"]): Judgment => ({ judge, pairId, verdict, quote: "", missing: "", quoteValid: verdict !== "supported", costUsd: 0.01 });

  it("reports planted errors caught, invented quotes, agreement and the consensus support rate", () => {
    const out = summarize(pairs, [j("x", "a", "supported"), j("y", "a", "supported"), j("x", "b", "partial"), j("y", "b", "unsupported"), j("x", "c", "unsupported"), j("y", "c", "supported")], ["x", "y"]);
    expect(out).toContain("2 real claims, 1 planted");
    expect(out).toMatch(/\| x \| 50\.0% \| 50\.0% \| 0\.0% \| 1\/1 \(100\.0%\) \| 1 \|/);
    expect(out).toMatch(/\| y \| 50\.0% \| 0\.0% \| 50\.0% \| 0\/1 \(0\.0%\) \| 1 \|/);
    expect(out).toContain("Agreement on real claims: 1/2 (50.0%)");
    expect(out).toContain("1/1 claims are supported (100.0%)");
  });
});
