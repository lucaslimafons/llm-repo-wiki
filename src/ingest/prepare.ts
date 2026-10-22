import { createHash } from "node:crypto";
import { detectLang } from "./chunk/lang";
import { contentSkipReason, MAX_FILE_BYTES, parseGitattributes, pathSkipReason, type SkipReason } from "./filters";
import { scanSecrets } from "./secrets";

export type PreparedFile = { path: string; text: string; hash: string; lang: string | null };
export type DroppedFile = { path: string; reason: SkipReason | "secret"; rules?: string[] };

export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Tarball pre-filter: never buffer a body we would throw away. `.gitattributes` is always kept. */
export function acceptTarEntry(path: string, size: number): boolean {
  if (path === ".gitattributes") return true;
  return size <= MAX_FILE_BYTES && pathSkipReason(path) === null;
}

/** Filters, then secret-scans, every file. Only what survives may be chunked and embedded. */
export function prepareFiles(raw: Map<string, Buffer>): { files: Map<string, PreparedFile>; dropped: DroppedFile[] } {
  const attrs = raw.get(".gitattributes");
  const isLinguist = parseGitattributes(attrs ? attrs.toString("utf8") : "");
  const files = new Map<string, PreparedFile>();
  const dropped: DroppedFile[] = [];
  const decoder = new TextDecoder("utf-8");

  for (const [path, buf] of raw) {
    const pathReason = pathSkipReason(path) ?? (isLinguist(path) ? "linguist" : null);
    if (pathReason) {
      dropped.push({ path, reason: pathReason });
      continue;
    }
    const text = decoder.decode(buf);
    const reason = contentSkipReason(buf, text);
    if (reason) {
      dropped.push({ path, reason });
      continue;
    }
    if (!text.trim()) continue;
    const findings = scanSecrets(text);
    if (findings.length) {
      const rules = [...new Set(findings.map((f) => f.rule))];
      // Rule names and line numbers only: the value must never reach a log either.
      console.warn(`[secrets] dropped ${path}: ${findings.map((f) => `${f.rule}@L${f.line}`).join(", ")}`);
      dropped.push({ path, reason: "secret", rules });
      continue;
    }
    files.set(path, { path, text, hash: sha256(buf), lang: detectLang(path) });
  }
  return { files, dropped };
}
