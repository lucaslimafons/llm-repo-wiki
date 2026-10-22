/**
 * Gitleaks-style secret scanner, run on every file before it is chunked. A match DROPS the whole
 * file: redacting one line misses multi-line keys and the neighbouring lines that name what the
 * key unlocks. Findings carry the rule and line, never the matched value.
 */

export type SecretFinding = { rule: string; line: number };

type Rule = { id: string; re: RegExp; /** Capture group that must clear the entropy bar. */ entropyGroup?: number; minEntropy?: number };

const RULES: Rule[] = [
  { id: "private-key", re: /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/ },
  { id: "aws-access-key-id", re: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/ },
  {
    id: "aws-secret-access-key",
    re: /aws.{0,20}?(?:secret|sk|key).{0,20}?['"\s:=]+([A-Za-z0-9/+]{40})(?![A-Za-z0-9/+])/i,
    entropyGroup: 1,
    minEntropy: 4,
  },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/ },
  { id: "github-fine-grained-pat", re: /\bgithub_pat_[A-Za-z0-9_]{60,255}\b/ },
  { id: "anthropic-api-key", re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,}/ },
  { id: "openrouter-api-key", re: /\bsk-or-v1-[a-f0-9]{64}\b/ },
  { id: "openai-api-key", re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}/ },
  { id: "openai-api-key-legacy", re: /\bsk-[A-Za-z0-9]{48}\b/ },
  { id: "slack-token", re: /\bxox[abposr]-(?:\d+-)?[A-Za-z0-9-]{10,}/ },
  { id: "slack-webhook", re: /https:\/\/hooks\.slack\.com\/(?:services|workflows)\/[A-Za-z0-9+/]{20,}/ },
  { id: "stripe-key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/ },
  { id: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    id: "generic-api-key",
    re: /(?:api[_-]?key|apikey|secret|token|passwd|password|auth[_-]?key|access[_-]?key|client[_-]?secret)[\w.-]{0,20}["']?\s*(?:=|:|:=|=>)\s*["'`]([A-Za-z0-9_\-+/=.~]{16,})["'`]/i,
    entropyGroup: 1,
    minEntropy: 3.7,
  },
];

export function shannonEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

// Placeholders and env lookups look like assignments but are not secrets.
const PLACEHOLDER_RE = /^(?:x+|\*+|<.*>|\$\{.*\}|your[_-]|example|changeme|placeholder|dummy|test[_-]?key)/i;

function passesEntropy(value: string, min: number): boolean {
  if (PLACEHOLDER_RE.test(value)) return false;
  // Real keys mix letters and digits; identifiers like `process.env.FOO_BAR_TOKEN` do not.
  if (!/[0-9]/.test(value) || !/[A-Za-z]/.test(value)) return false;
  return shannonEntropy(value) >= min;
}

export function scanSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      if (rule.entropyGroup !== undefined && !passesEntropy(m[rule.entropyGroup] ?? "", rule.minEntropy ?? 3.5)) continue;
      findings.push({ rule: rule.id, line: i + 1 });
    }
  }
  return findings;
}
