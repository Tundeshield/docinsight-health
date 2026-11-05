// Citation validation for AI answers (PRD section 7, "Validate citations").
// The model cites passages as [P1], [P2]… Every factual sentence must carry at least
// one citation, and every cited passage must be one that was retrieved.

export interface SentenceCheck {
  sentence: string;
  cited: number[];
  ok: boolean;
  reason?: "uncited" | "unknown_passage";
}

export interface ValidationResult {
  ok: boolean;
  sentences: SentenceCheck[];
  cited: number[];
  unknown: number[];
  uncitedCount: number;
}

const CITE = /\[P(\d+)(?:\s*[,;]\s*P?(\d+))*\]/g;
const CITE_NUMS = /P?(\d+)/g;

/** Lines that aren't factual claims: headings, list labels ending in ':', blank lines, the warning prefix. */
function isNonClaim(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (/^#{1,6}\s/.test(t)) return true;
  if (/:\s*$/.test(t) && t.length < 80) return true; // "Steps:" style lead-ins
  if (/^(\*\*)?(note|warning|steps|in summary)(\*\*)?:?$/i.test(t)) return true;
  if (/^[-*_]{3,}$/.test(t)) return true;
  return false;
}

/** Splits markdown into sentence-ish units: list items and sentences inside paragraphs. */
export function splitSentences(md: string): string[] {
  const out: string[] = [];
  for (const rawLine of md.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(\d+[.)]|[-*•])\s+/.test(line) || /^#{1,6}\s/.test(line) || /^\|/.test(line) || /^>/.test(line)) {
      out.push(line);
      continue;
    }
    // Split on sentence ends that are followed by a space and a capital/quote/digit,
    // but keep citations attached to the sentence they follow: "…dose. [P1] Next" → "…dose. [P1]"
    const parts = line.split(/(?<=[.!?](?:\s*\[P[\d,;\sP]+\])*)\s+(?=[A-Z0-9"“(])/);
    for (const p of parts) if (p.trim()) out.push(p.trim());
  }
  return out;
}

export function citedNumbers(s: string): number[] {
  const nums: number[] = [];
  for (const m of s.matchAll(CITE)) for (const n of m[0].matchAll(CITE_NUMS)) nums.push(Number(n[1]));
  return [...new Set(nums)];
}

export function validateCitations(answer: string, passageCount: number): ValidationResult {
  const sentences: SentenceCheck[] = [];
  const allCited = new Set<number>();
  const unknown = new Set<number>();
  // A table row or list item may lean on a citation given in the line just before it (the lead-in).
  for (const s of splitSentences(answer)) {
    if (isNonClaim(s)) continue;
    const cited = citedNumbers(s);
    cited.forEach((n) => allCited.add(n));
    const bad = cited.filter((n) => n < 1 || n > passageCount);
    bad.forEach((n) => unknown.add(n));
    if (/^\|[\s:-|]+\|$/.test(s)) continue; // table divider
    if (!cited.length) sentences.push({ sentence: s, cited, ok: false, reason: "uncited" });
    else if (bad.length) sentences.push({ sentence: s, cited, ok: false, reason: "unknown_passage" });
    else sentences.push({ sentence: s, cited, ok: true });
  }
  const uncitedCount = sentences.filter((x) => !x.ok).length;
  return { ok: uncitedCount === 0, sentences, cited: [...allCited].filter((n) => !unknown.has(n)).sort((a, b) => a - b), unknown: [...unknown], uncitedCount };
}

/** Removes sentences that failed validation. Used when a regeneration still fails. */
export function stripInvalid(answer: string, result: ValidationResult): string {
  let out = answer;
  for (const s of result.sentences) if (!s.ok) out = out.replace(s.sentence, "");
  return out.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
}

/** Renumbers [P3] style passage citations to [1], [2]… in order of first use. */
export function renumber(answer: string): { text: string; order: number[] } {
  const order: number[] = [];
  const text = answer.replace(CITE, (m) => {
    const nums = citedNumbers(m);
    const mapped = nums.map((n) => {
      if (!order.includes(n)) order.push(n);
      return order.indexOf(n) + 1;
    });
    return mapped.map((n) => `[${n}]`).join("");
  });
  return { text, order };
}
