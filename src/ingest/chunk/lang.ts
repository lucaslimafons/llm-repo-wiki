const EXT_LANG: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  py: "python", pyi: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin",
  rb: "ruby", php: "php", cs: "csharp", swift: "swift", scala: "scala", c: "c", h: "c",
  cc: "cpp", cpp: "cpp", hpp: "cpp", cxx: "cpp", m: "objc", dart: "dart", ex: "elixir", exs: "elixir",
  lua: "lua", r: "r", sh: "shell", bash: "shell", zsh: "shell", fish: "shell", ps1: "powershell",
  sql: "sql", graphql: "graphql", gql: "graphql", proto: "protobuf", prisma: "prisma",
  vue: "vue", svelte: "svelte", astro: "astro", html: "html", css: "css", scss: "scss", less: "less",
  json: "json", jsonc: "json", yaml: "yaml", yml: "yaml", toml: "toml", xml: "xml", ini: "ini",
  tf: "hcl", hcl: "hcl", nix: "nix", zig: "zig",
  md: "markdown", mdx: "markdown", markdown: "markdown", rst: "rst", adoc: "asciidoc", txt: "text",
};

const NAMED: Record<string, string> = {
  Dockerfile: "dockerfile", Makefile: "make", Justfile: "make", Gemfile: "ruby", Rakefile: "ruby",
  LICENSE: "text", README: "text",
};

export function detectLang(path: string): string | null {
  const base = path.split("/").at(-1) ?? "";
  if (NAMED[base]) return NAMED[base];
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  return EXT_LANG[base.slice(dot + 1).toLowerCase()] ?? null;
}

const DOC_LANGS = new Set(["markdown", "rst", "asciidoc", "text"]);

export const isDocLang = (lang: string | null) => lang !== null && DOC_LANGS.has(lang);
