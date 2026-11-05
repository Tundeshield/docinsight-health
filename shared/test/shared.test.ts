import { describe, expect, it } from "vitest";
import { tickBilling, memberAccess, capabilities, periodPrice, limitState, formatMoney, monthlyRevenue } from "../src/billing";
import { detectPii } from "../src/pii";
import { validateCitations, stripInvalid, renumber, splitSentences } from "../src/citations";
import { chunkPages, cleanPages, parseBlocks, buildBm25, searchBm25, tokenize, rrf, markdownToPages } from "../src/text";
import { DEFAULT_PLANS } from "../src/config";

const day = 86_400_000;
const d = (s: string) => new Date(s + "T00:00:00Z");

describe("billing status machine (PRD section 4)", () => {
  const base = { remindersSent: [] as number[], cancelledAt: null, pastDueSince: null };
  it("stays pending until first payment", () => {
    expect(tickBilling({ ...base, status: "pending_payment", currentPeriodEnd: null }, d("2026-11-01")).status).toBe("pending_payment");
  });
  it("is active before the period ends", () => {
    expect(tickBilling({ ...base, status: "active", currentPeriodEnd: d("2026-12-01") }, d("2026-11-15")).status).toBe("active");
  });
  it("goes past due, restricted at 15 days, suspended at 45", () => {
    const end = d("2026-11-01");
    const at = (n: number) => tickBilling({ ...base, status: "active", currentPeriodEnd: end }, new Date(end.getTime() + n * day));
    expect(at(0).status).toBe("past_due");
    expect(at(14).status).toBe("past_due");
    expect(at(15).status).toBe("restricted");
    expect(at(44).status).toBe("restricted");
    expect(at(45).status).toBe("suspended");
  });
  it("sends reminders on days 1, 7 and 14, one at a time", () => {
    const end = d("2026-11-01");
    expect(tickBilling({ ...base, status: "past_due", currentPeriodEnd: end, pastDueSince: end }, new Date(end.getTime() + 1 * day)).sendReminders).toEqual([1]);
    expect(tickBilling({ ...base, status: "past_due", currentPeriodEnd: end, pastDueSince: end, remindersSent: [1] }, new Date(end.getTime() + 8 * day)).sendReminders).toEqual([7]);
    expect(tickBilling({ ...base, status: "past_due", currentPeriodEnd: end, pastDueSince: end }, new Date(end.getTime() + 20 * day)).sendReminders).toEqual([14]);
  });
  it("a payment that moves the period end forward reactivates", () => {
    const r = tickBilling({ ...base, status: "restricted", currentPeriodEnd: d("2027-01-01"), pastDueSince: d("2026-11-01") }, d("2026-12-01"));
    expect(r.status).toBe("active"); expect(r.pastDueSince).toBeNull();
  });
  it("deletes a cancelled tenant only after 90 days", () => {
    expect(tickBilling({ ...base, status: "cancelled", currentPeriodEnd: null, cancelledAt: d("2026-01-01") }, d("2026-03-31")).deleteTenant).toBe(false);
    expect(tickBilling({ ...base, status: "cancelled", currentPeriodEnd: null, cancelledAt: d("2026-01-01") }, d("2026-04-01")).deleteTenant).toBe(true);
  });
  it("derives member access and capabilities", () => {
    expect(memberAccess("pending_payment", "staff")).toBe("none");
    expect(memberAccess("pending_payment", "admin")).toBe("full");
    expect(memberAccess("restricted", "staff")).toBe("read");
    expect(memberAccess("suspended", "owner")).toBe("admin_only");
    expect(memberAccess("suspended", "staff")).toBe("none");
    expect(capabilities("restricted")).toMatchObject({ read: true, ask: false, upload: false, inviteStaff: false });
    expect(capabilities("pending_payment").inviteStaff).toBe(false);
  });
  it("prices plans: annual = 10 months, pilot 50%, money in kobo", () => {
    const hospital = DEFAULT_PLANS.find((p) => p.id === "hospital")!;
    expect(periodPrice(hospital, "monthly")).toBe(20_000_000);
    expect(periodPrice(hospital, "annual")).toBe(200_000_000);
    expect(periodPrice(hospital, "monthly", { pilotDiscountPct: 50 })).toBe(10_000_000);
    expect(formatMoney(20_000_000, "NGN")).toBe("₦200,000");
    expect(monthlyRevenue(hospital, "annual", "active")).toBe(16_666_667);
    expect(monthlyRevenue(hospital, "monthly", "suspended")).toBe(0);
  });
  it("warns at 80% and blocks at 100%", () => {
    expect(limitState(79, 100)).toBe("ok"); expect(limitState(80, 100)).toBe("warn"); expect(limitState(100, 100)).toBe("blocked"); expect(limitState(5, null)).toBe("ok");
  });
});

describe("patient identifier detector", () => {
  const blocked = [
    "What antibiotic for Mrs Adebayo in bed 4?", "patient named Chinedu Okafor has sepsis", "Hosp no 123456 needs transfusion",
    "call 08031234567 about the result", "MRN: LUTH/2024/0091", "baby Okonkwo is jaundiced", "DOB 12/04/1990 patient",
    "Bed 6, Fatima needs her dose", "+234 803 123 4567",
  ];
  const allowed = [
    "What is our sepsis bundle?", "How do I set up the infusion pump?", "Dose of ceftriaxone for adults with meningitis",
    "Does CareShield need pre-authorisation for a CT scan?", "What is the transfusion procedure for a patient with sickle cell?",
    "Give 1000 mg paracetamol", "What does error code E12 mean?", "Who approves blood transfusion requests in theatre?",
    "Postpartum haemorrhage protocol", "Patient with fever after surgery: what are the steps?",
  ];
  for (const q of blocked) it(`blocks: ${q}`, () => expect(detectPii(q).length).toBeGreaterThan(0));
  for (const q of allowed) it(`allows: ${q}`, () => expect(detectPii(q)).toEqual([]));
});

describe("citation validation", () => {
  it("accepts a fully cited answer", () => {
    const a = "Give oxygen to keep saturations above 94%. [P1]\n\n1. Take blood cultures before antibiotics. [P2]\n2. Give IV antibiotics within one hour. [P2][P3]";
    const r = validateCitations(a, 3);
    expect(r.ok).toBe(true); expect(r.cited).toEqual([1, 2, 3]);
  });
  it("flags uncited sentences and unknown passages", () => {
    const r = validateCitations("Give oxygen. [P1] Start fluids too. Check lactate. [P9]", 3);
    expect(r.ok).toBe(false); expect(r.uncitedCount).toBe(2); expect(r.unknown).toEqual([9]);
    expect(stripInvalid("Give oxygen. [P1] Start fluids too. Check lactate. [P9]", r)).toBe("Give oxygen. [P1]");
  });
  it("ignores headings and lead-ins", () => {
    expect(validateCitations("## Steps\nDo this:\n1. Stop the pump. [P1]", 1).ok).toBe(true);
  });
  it("splits sentences without breaking citations", () => {
    expect(splitSentences("Stop it. [P1] Then call ext 2270. [P2]")).toEqual(["Stop it. [P1]", "Then call ext 2270. [P2]"]);
  });
  it("renumbers in order of first use", () => {
    expect(renumber("A. [P3] B. [P1][P3] C. [P2, P1]")).toEqual({ text: "A. [1] B. [2][1] C. [3][2]", order: [3, 1, 2] });
  });
});

describe("cleaning and chunking", () => {
  const pages = Array.from({ length: 4 }, (_, i) => ({
    n: i + 1, label: String(i + 1),
    text: `RIVERSIDE HOSPITAL — SEPSIS PROTOCOL v4\n${i === 0 ? "1. Purpose\nThis protocol describes the sepsis bundle for adult patients in all wards." : "Text on page " + (i + 1) + " about sepsis management and escalation."}\nPage ${i + 1} of 4`,
  }));
  it("removes running headers and page numbers", () => {
    const c = cleanPages(pages);
    expect(c[0].text).not.toMatch(/RIVERSIDE HOSPITAL/); expect(c[1].text).not.toMatch(/Page 2 of 4/);
  });
  it("keeps numbered lists and tables whole", () => {
    const items = Array.from({ length: 30 }, (_, i) => `${i + 1}. Step ${i + 1}: ${"check the patient and record the observation carefully ".repeat(3)}`).join("\n");
    const table = "| Drug | Dose |\n|---|---|\n" + Array.from({ length: 10 }, (_, i) => `| Drug ${i} | ${i} mg |`).join("\n");
    const chunks = chunkPages([{ n: 1, label: "1", text: "# Procedure\n" + items }, { n: 2, label: "2", text: "## Doses\n" + table + "\n\n" + "Notes paragraph. ".repeat(50) }]);
    for (const c of chunks) {
      const lines = c.text.split("\n").filter((l) => /^\d+\./.test(l));
      lines.forEach((l) => expect(l).toMatch(/record the observation carefully\s*$/));
    }
    const withTable = chunks.find((c) => c.text.includes("| Drug 0 |"))!;
    expect(withTable.text).toContain("| Drug 9 |");
  });
  it("targets 400–800 words and records headings and pages", () => {
    const para = (n: number) => Array.from({ length: n }, (_, i) => `Sentence ${i} about postpartum haemorrhage management in the labour ward.`).join(" ");
    const chunks = chunkPages([
      { n: 1, label: "1", text: "# Postpartum haemorrhage\n## Recognition\n" + para(60) },
      { n: 2, label: "2", text: "## Management\n" + para(90) },
      { n: 3, label: "3", text: para(90) },
    ]);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) expect(c.wordCount).toBeLessThanOrEqual(1500);
    expect(chunks[0].headingPath).toMatch(/Postpartum haemorrhage/);
    expect(chunks.some((c) => c.pages[1] >= 2)).toBe(true);
  });
  it("splits in-app pages at H2", () => {
    const md = "# Title\nIntro " + "word ".repeat(200) + "\n\n## Part two\nMore " + "word ".repeat(200);
    expect(markdownToPages(md).length).toBe(2);
  });
  it("detects headings and lists", () => {
    const b = parseBlocks([{ n: 1, label: "1", text: "SEPSIS SCREENING\nScreen all adults.\n1. Check NEWS2\n2. Call the doctor" }]);
    expect(b.map((x) => x.kind)).toEqual(["heading", "paragraph", "list"]);
  });
});

describe("keyword search", () => {
  const ix = buildBm25([
    { id: "a", text: "Postpartum haemorrhage protocol: oxytocin, uterine massage" },
    { id: "b", text: "Infusion pump error E-21 pressure sensor fault" },
    { id: "c", text: "Sepsis screening with NEWS2" },
  ]);
  it("matches British and American spellings", () => expect(searchBm25(ix, "postpartum hemorrhage")[0].id).toBe("a"));
  it("matches error codes", () => expect(searchBm25(ix, "E-21")[0].id).toBe("b"));
  it("tokenizes accents", () => expect(tokenize("réanimation")).toContain("reanimation"));
  it("fuses rankings", () => expect(rrf([["a", "b"], ["b", "c"]])[0].id).toBe("b"));
});
