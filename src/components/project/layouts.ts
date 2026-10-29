import type { WikiLayout } from "@/project/schema";

/** The layout choices, shared by the new-wiki form and the settings page. */
export const LAYOUT_OPTIONS: { value: WikiLayout; label: string; hint: string }[] = [
  { value: "topic", label: "By topic", hint: "One shared tree; each repo's subsystems under Architecture/<part>. For repos that ship as one product." },
  { value: "repo", label: "By repository", hint: "A top-level folder per repo with its own Architecture, Guides and Reference. For repos read separately." },
];
