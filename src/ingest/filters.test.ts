import { describe, expect, it } from "vitest";
import { contentSkipReason, isBinary, parseGitattributes, pathSkipReason } from "./filters";
import { prepareFiles } from "./prepare";

describe("pathSkipReason", () => {
  it.each([
    ["node_modules/react/index.js", "vendored-dir"],
    ["packages/a/dist/index.js", "vendored-dir"],
    ["vendor/github.com/x/y.go", "vendored-dir"],
    ["web/.next/server/app.js", "vendored-dir"],
    ["coverage/lcov.info", "vendored-dir"],
    ["build/out.js", "vendored-dir"],
    ["src/__snapshots__/a.test.ts.snap", "vendored-dir"],
    ["pnpm-lock.yaml", "lockfile"],
    ["sub/package-lock.json", "lockfile"],
    ["Cargo.lock", "lockfile"],
    ["public/app.min.js", "generated"],
    ["styles/site.min.css", "generated"],
    ["dist-free/index.js.map", "generated"],
    [".env", "sensitive"],
    [".env.local", "sensitive"],
    ["config/.env.production", "sensitive"],
    ["certs/server.pem", "sensitive"],
    ["keys/private.key", "sensitive"],
    ["home/.ssh/id_rsa", "sensitive"],
    ["home/.ssh/id_rsa.pub", "sensitive"],
    ["assets/logo.png", "binary"],
  ])("%s → %s", (path, reason) => {
    expect(pathSkipReason(path)).toBe(reason);
  });

  it.each(["src/index.ts", "README.md", "docs/build.md", "src/distance.ts", "src/environment.ts"])(
    "keeps %s",
    (path) => {
      expect(pathSkipReason(path)).toBeNull();
    },
  );
});

describe("content rules", () => {
  it("detects a NUL byte in the first 8KB as binary", () => {
    expect(isBinary(Buffer.from("abc\0def"))).toBe(true);
    expect(isBinary(Buffer.from("plain text"))).toBe(false);
    const late = Buffer.concat([Buffer.alloc(9000, 97), Buffer.from([0])]);
    expect(isBinary(late)).toBe(false);
  });

  it("skips files over 300KB and files with a line over 1000 chars", () => {
    const big = "a\n".repeat(160_000);
    expect(contentSkipReason(Buffer.from(big), big)).toBe("too-large");
    const minified = `ok\n${"x".repeat(1001)}\n`;
    expect(contentSkipReason(Buffer.from(minified), minified)).toBe("long-line");
    const fine = `${"x".repeat(1000)}\nok`;
    expect(contentSkipReason(Buffer.from(fine), fine)).toBeNull();
  });
});

describe("parseGitattributes", () => {
  const match = parseGitattributes(
    [
      "# comment",
      "*.pb.go linguist-generated=true",
      "/generated/** linguist-generated",
      "third_party/ linguist-vendored",
      "third_party/keep.ts -linguist-vendored",
      "docs/*.md linguist-documentation",
    ].join("\n"),
  );

  it.each([
    ["api/v1/service.pb.go", true],
    ["generated/client/index.ts", true],
    ["src/generated/x.ts", false],
    ["third_party/lib/a.c", true],
    ["third_party/keep.ts", false],
    ["docs/intro.md", false],
    ["src/index.ts", false],
  ])("%s → %s", (path, skip) => {
    expect(match(path)).toBe(skip);
  });

  it("drops linguist paths from prepared files", () => {
    const { files, dropped } = prepareFiles(
      new Map([
        [".gitattributes", Buffer.from("gen/** linguist-generated\n")],
        ["gen/a.ts", Buffer.from("export const a = 1;\n")],
        ["src/b.ts", Buffer.from("export const b = 2;\n")],
      ]),
    );
    expect([...files.keys()].sort()).toEqual([".gitattributes", "src/b.ts"]);
    expect(dropped).toEqual([{ path: "gen/a.ts", reason: "linguist" }]);
  });
});
