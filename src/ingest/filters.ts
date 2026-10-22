/** What never gets chunked. Path rules run before a tarball body is buffered; content rules after. */

export const MAX_FILE_BYTES = 300 * 1024;
export const MAX_LINE_CHARS = 1000;

const SKIP_DIRS = new Set(["node_modules", "vendor", "dist", "build", ".next", "coverage", ".git", "__snapshots__"]);

const LOCKFILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "npm-shrinkwrap.json",
  "composer.lock",
  "Gemfile.lock",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "go.sum",
  "flake.lock",
  "mix.lock",
  "pubspec.lock",
  "Podfile.lock",
  "packages.lock.json",
]);

// Credential-shaped files are refused by name, before the secret scanner ever sees them.
const SENSITIVE_RE = /^(?:\.env(?:\..*)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_rsa.*|id_ed25519.*|id_ecdsa.*|id_dsa.*)$/i;
const GENERATED_RE = /\.min\.[a-z0-9]+$|\.map$|\.snap$/i;
const BINARY_EXT_RE =
  /\.(?:png|jpe?g|gif|webp|avif|ico|bmp|tiff?|psd|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|woff2?|ttf|otf|eot|mp[34]|mov|avi|webm|wav|ogg|flac|exe|dll|so|dylib|a|o|class|wasm|pyc|bin|dat|db|sqlite3?)$/i;

export type SkipReason =
  | "sensitive"
  | "vendored-dir"
  | "lockfile"
  | "generated"
  | "binary"
  | "too-large"
  | "long-line"
  | "linguist";

export function pathSkipReason(path: string): SkipReason | null {
  const segs = path.split("/");
  const base = segs.at(-1) ?? "";
  if (SENSITIVE_RE.test(base)) return "sensitive";
  if (segs.slice(0, -1).some((s) => SKIP_DIRS.has(s))) return "vendored-dir";
  if (LOCKFILES.has(base)) return "lockfile";
  if (GENERATED_RE.test(base)) return "generated";
  if (BINARY_EXT_RE.test(base)) return "binary";
  return null;
}

export function isBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export function contentSkipReason(buf: Uint8Array, text: string): SkipReason | null {
  if (buf.length > MAX_FILE_BYTES) return "too-large";
  if (isBinary(buf)) return "binary";
  // Minified or generated output: one enormous line poisons both chunking and embeddings.
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text.charCodeAt(i) === 10) {
      if (i - lineStart > MAX_LINE_CHARS) return "long-line";
      lineStart = i + 1;
    }
  }
  return null;
}

// ── .gitattributes (linguist-generated / linguist-vendored) ─────────────────

type AttrRule = { re: RegExp; skip: boolean };

/** Returns a matcher over the root `.gitattributes`; later lines win, as in git. */
export function parseGitattributes(text: string): (path: string) => boolean {
  const rules: AttrRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [pattern, ...attrs] = line.split(/\s+/);
    let skip: boolean | undefined;
    for (const a of attrs) {
      const m = /^(-|!)?linguist-(generated|vendored)(?:=(\w+))?$/.exec(a);
      if (!m) continue;
      skip = m[1] ? false : m[3] === undefined || m[3] === "true" || m[3] === "1";
    }
    if (skip !== undefined) rules.push({ re: globToRegExp(pattern), skip });
  }
  if (rules.length === 0) return () => false;
  return (path) => {
    let skip = false;
    for (const r of rules) if (r.re.test(path)) skip = r.skip;
    return skip;
  };
}

function globToRegExp(pattern: string): RegExp {
  let p = pattern;
  const anchored = p.startsWith("/") || p.slice(0, -1).includes("/");
  p = p.replace(/^\//, "");
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      re += ".*";
      i++;
      if (p[i + 1] === "/") i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const prefix = anchored ? "^" : "^(?:.*/)?";
  // A pattern naming a directory also covers everything below it.
  return new RegExp(`${prefix}${re}${dirOnly ? "/.*" : "(?:/.*)?"}$`);
}
