// Detects likely patient identifiers in a question (PRD section 10).
// Questions that trip it are blocked, not stored, and the user is asked to rephrase.
// It errs towards blocking: a false alarm costs a rephrase; a miss stores patient data.

export interface PiiHit {
  kind: "phone" | "hospital_number" | "name" | "date_of_birth" | "email";
  match: string;
}

const TITLE_WORDS = ["mr", "mrs", "ms", "miss", "master", "baby", "chief", "alhaji", "alhaja", "mallam", "madam", "mama", "papa", "dr", "prof", "pastor", "rev", "engr", "barr", "hon", "mme", "mlle", "madame", "monsieur"];
// Case-insensitive titles ("Mrs", "MRS") without making the following name pattern case-insensitive
const TITLES = `(?:${TITLE_WORDS.map((w) => [...w].map((c) => `[${c.toUpperCase()}${c}]`).join("")).join("|")})`;

const PATTERNS: { kind: PiiHit["kind"]; re: RegExp }[] = [
  // Nigerian and international phone numbers
  { kind: "phone", re: /(?:\+?234[\s-]?|\b0)[789][01]\d[\s-]?\d{3}[\s-]?\d{4}\b/g },
  { kind: "phone", re: /\+\d{1,3}[\s-]?\d{3,4}[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g },
  // Hospital / record numbers: labelled, or long digit runs / alphanumeric IDs
  { kind: "hospital_number", re: /\b(?:mrn|hosp(?:ital)?\.?\s*(?:no|num|number|id)|folder\s*(?:no|number)|card\s*(?:no|number)|patient\s*(?:no|id|number)|reg(?:istration)?\s*(?:no|number)|record\s*(?:no|number)|nhia\s*(?:no|number|id)|hmo\s*(?:id|no|number)|enrollee\s*(?:id|no))\b[\s:#.-]*[a-z0-9/-]*/gi },
  { kind: "hospital_number", re: /\b[A-Z]{1,4}[-/]?\d{4,}(?:[-/]\d+)*\b/g },
  { kind: "hospital_number", re: /\b\d{6,}\b/g },
  // Dates of birth
  { kind: "date_of_birth", re: /\b(?:dob|d\.o\.b|date of birth|born on)\b[\s:]*[\d/.\- a-z]{0,20}/gi },
  { kind: "email", re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g },
  // Titles followed by a capitalised name: "Mrs Adebayo", "Baby Okafor"
  { kind: "name", re: new RegExp(`\\b${TITLES}\\.?\\s+[A-Z][a-zA-Z'-]{1,}(?:\\s+[A-Z][a-zA-Z'-]{1,})?`, "g") },
  // "patient (named|called) X", "my patient X Y", "for patient X"
  { kind: "name", re: /\b(?:[Pp]atient|[Pp]t|[Cc]lient|[Bb]aby|[Cc]hild|[Ww]oman|[Mm]an)\s+(?:named|called|is|-|:)?\s*[A-Z][a-z'-]{2,}(?:\s+[A-Z][a-z'-]{2,})?/g },
  { kind: "name", re: /\b(?:named|called|name is)\s+[A-Z][a-z'-]{2,}(?:\s+[A-Z][a-z'-]{2,})?/g },
  // "Bed 4, Adewale" style: bed/ward then a capitalised word
  { kind: "name", re: /\b[Bb]ed\s*\d+\s*[,:-]\s*[A-Z][a-z'-]{2,}/g },
];

// Capitalised words that are clinical or document terms, not names, after "patient" etc.
const NOT_NAMES = new Set([
  "With", "Has", "Had", "Who", "On", "In", "At", "After", "Before", "For", "And", "The", "A", "An",
  "Admitted", "Presenting", "Diagnosed", "Post", "Pre", "Requiring", "Needing", "Under", "From",
]);

export function detectPii(question: string): PiiHit[] {
  const hits: PiiHit[] = [];
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    for (const m of question.matchAll(re)) {
      const match = m[0].trim();
      if (kind === "name") {
        const words = match.split(/\s+/).slice(1).map((w) => w.replace(/[^A-Za-z'-]/g, ""));
        if (words.every((w) => !w || NOT_NAMES.has(w))) continue;
      }
      if (kind === "hospital_number" && /^\d+$/.test(match) && /\b(?:mg|mcg|ml|units?|iu|mmol|kg|g)\b/i.test(question.slice((m.index ?? 0) + match.length, (m.index ?? 0) + match.length + 6))) continue;
      hits.push({ kind, match });
    }
  }
  return hits;
}

export function piiMessage(hits: PiiHit[]): string {
  const kinds = [...new Set(hits.map((h) => h.kind))];
  const words: Record<PiiHit["kind"], string> = {
    phone: "a phone number",
    hospital_number: "a hospital or record number",
    name: "a name",
    date_of_birth: "a date of birth",
    email: "an email address",
  };
  const list = kinds.map((k) => words[k]);
  const joined = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0];
  return `This question looks like it contains ${joined}. DocInsight answers questions about protocols, not about individual patients, so it wasn't sent or saved. Remove anything that identifies a patient and ask again.`;
}
