import { describe, expect, it } from "vitest";
import { createOwnerRoutedClient, type FetchLike } from "./client";
import { githubTokensSchema, tokenForOwner } from "./tokens";

describe("githubTokensSchema", () => {
  it("parses owner=token pairs, lowercasing owners and trimming whitespace", () => {
    const tokens = githubTokensSchema.parse(" Acme=tok_a , other-co=tok_b,");
    expect([...tokens]).toEqual([
      ["acme", "tok_a"],
      ["other-co", "tok_b"],
    ]);
  });

  it("treats unset and empty as no per-owner tokens", () => {
    expect(githubTokensSchema.parse(undefined).size).toBe(0);
    expect(githubTokensSchema.parse("").size).toBe(0);
  });

  it("keeps an = inside the token", () => {
    expect(githubTokensSchema.parse("acme=a=b").get("acme")).toBe("a=b");
  });

  it.each(["s3cr3t", "=s3cr3t", "acme=", "bad owner=s3cr3t", "-acme=s3cr3t"])("rejects %j without echoing the token", (raw) => {
    const result = githubTokensSchema.safeParse(raw);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain("s3cr3t");
  });

  it("rejects the same owner twice, whatever the case", () => {
    expect(githubTokensSchema.safeParse("acme=tok_a,ACME=tok_b").success).toBe(false);
  });
});

describe("tokenForOwner", () => {
  const tokens = new Map([["acme", "tok_a"]]);

  it("prefers the owner's own token, case-insensitively", () => {
    expect(tokenForOwner(tokens, "tok_default", "ACME")).toBe("tok_a");
  });

  it("falls back to the default token, or none", () => {
    expect(tokenForOwner(tokens, "tok_default", "vercel")).toBe("tok_default");
    expect(tokenForOwner(tokens, undefined, "vercel")).toBeUndefined();
  });
});

describe("createOwnerRoutedClient", () => {
  it("sends each owner's token to that owner's repos only", async () => {
    const seen: Array<[string, string | null]> = [];
    const fetch: FetchLike = async (url, init) => {
      seen.push([url, new Headers(init?.headers).get("authorization")]);
      return Response.json({ default_branch: "main", private: true });
    };
    const tokens = new Map([
      ["acme", "tok_a"],
      ["other-co", "tok_b"],
    ]);
    const client = createOwnerRoutedClient((owner) => tokenForOwner(tokens, undefined, owner), { fetch });

    await client.getRepo({ owner: "Acme", name: "api" });
    await client.getRepo({ owner: "other-co", name: "web" });
    await client.getRepo({ owner: "vercel", name: "next.js" });

    expect(seen).toEqual([
      ["https://api.github.com/repos/Acme/api", "Bearer tok_a"],
      ["https://api.github.com/repos/other-co/web", "Bearer tok_b"],
      ["https://api.github.com/repos/vercel/next.js", null],
    ]);
  });
});
