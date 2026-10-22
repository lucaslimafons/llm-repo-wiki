import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareFiles } from "./prepare";
import { scanSecrets, shannonEntropy } from "./secrets";

// Assembled at runtime so this file itself never trips a secret scanner (GitHub push protection).
const j = (...parts: string[]) => parts.join("");

const positives: [string, string][] = [
  ["aws-access-key-id", j("const id = 'AKIA", "IOSFODNN7EXAMPLE';")],
  ["aws-secret-access-key", j("aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/", "bPxRfiCYEXAMPLEKEY")], // gitleaks:allow (AWS docs example key)
  ["github-token", j("token: gh", "p_", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8")],
  ["github-fine-grained-pat", j("github", "_pat_", "11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123")],
  ["openai-api-key", j("OPENAI=sk-proj-", "abcdefghij1234567890", "T3BlbkFJ", "abcdefghij1234567890")],
  ["openrouter-api-key", j("key = 'sk-or-v1-", "0123456789abcdef".repeat(4), "'")],
  ["anthropic-api-key", j("ANTHROPIC=sk-ant-api03-", "A1b2C3d4E5".repeat(9))],
  ["slack-token", j("xox", "b-123456789012-abcdefghijKLMN")],
  ["stripe-key", j("sk", "_live_", "4eC39HqLyjWDarjtT1zdp7dc")],
  ["private-key", j("-----BEGIN RSA ", "PRIVATE KEY-----")],
  ["generic-api-key", j('const apiKey = "', "Zx9Qw7Lm3Np5Rt8Vb2Kd6Hf4", '";')],
];

describe("scanSecrets", () => {
  it.each(positives)("flags %s", (rule, line) => {
    expect(scanSecrets(`first line\n${line}\n`).map((f) => f.rule)).toContain(rule);
  });

  it("reports the 1-based line and never the value", () => {
    const [finding] = scanSecrets(`a\nb\n${positives[0][1]}`);
    expect(finding).toEqual({ rule: "aws-access-key-id", line: 3 });
  });

  it.each([
    ["a hash with no key-ish name", 'const integrity = "sha512-9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";'],
    ["a git sha", "commit 9fceb02d0ae598e95dc970b74767f19372d61af8"],
    ["an env lookup", "const token = process.env.GITHUB_TOKEN_FOR_TESTS;"],
    ["a placeholder", 'api_key = "your_api_key_goes_here_123"'],
    ["a low-entropy value", 'password = "aaaaaaaaaaaaaaaaaaaa1"'],
    ["a public key", "-----BEGIN PUBLIC KEY-----"],
    ["a uuid assigned to a token-named field", 'tokenId: "0d6c3f2e"'],
  ])("does not flag %s", (_name, line) => {
    expect(scanSecrets(line)).toEqual([]);
  });

  it("computes Shannon entropy in bits per char", () => {
    expect(shannonEntropy("aaaa")).toBe(0);
    expect(shannonEntropy("abcd")).toBe(2);
  });
});

describe("prepareFiles", () => {
  afterEach(() => vi.restoreAllMocks());

  it("drops a file with a secret and logs the rule and path, never the value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const leaked = positives[2][1];
    const { files, dropped } = prepareFiles(
      new Map([
        ["src/config.ts", Buffer.from(`export const x = 1;\n${leaked}\n`)],
        ["src/ok.ts", Buffer.from("export const ok = true;\n")],
      ]),
    );
    expect([...files.keys()]).toEqual(["src/ok.ts"]);
    expect(dropped).toEqual([{ path: "src/config.ts", reason: "secret", rules: ["github-token"] }]);
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("src/config.ts");
    expect(logged).toContain("github-token");
    expect(logged).not.toContain(leaked.slice(7));
  });
});
