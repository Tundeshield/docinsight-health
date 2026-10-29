// Smoke tests for the document pipeline. Run: npm test
import fs from "node:fs"; import assert from "node:assert/strict";
import { chunkMarkdown, htmlToMarkdown, pagesToSections } from "../src/chunking.js";
import { buildIndex, search } from "../src/search.js";
import { parseOcr } from "../src/prompts.js";
import { openPdf, extractPages, renderPage } from "../src/pdf.js";
import { pagePieces } from "../src/images.js";
import { CITE_RE } from "../src/ask.js";

const here = new URL("./fixtures/", import.meta.url).pathname;
let n = 0; const ok = (m) => console.log(`  ✓ ${m}`, ++n);

// Text PDF
const tp = await openPdf(fs.readFileSync(here + "text.pdf")); const tpages = await extractPages(tp);
assert.ok(tpages[0].text.includes("NEWS2")); ok("extracts text from a text PDF");
// Scanned PDF
const sp = await openPdf(fs.readFileSync(here + "scanned.pdf")); const spages = await extractPages(sp);
assert.ok(spages.every(p => p.text === "")); ok("detects scanned pages");
const png = await renderPage(sp, 1); const pieces = await pagePieces(png);
assert.equal(pieces.split, true); assert.equal(pieces.pieces.length, 2); ok("renders a scanned page and splits it into halves");
// OCR output → sections
const ocr = parseOcr("=== PAGE 1 ===\n# CHAPTER 4 INFUSION THERAPY\nCheck every [unclear: 15 or 45] minutes.\n=== PAGE 2 ===\n[Blank page]");
assert.deepEqual(Object.keys(ocr), ["1", "2"]); ok("parses OCR output by page");
const secs = pagesToSections([{ n: 1, text: ocr[1], ocr: true }, { n: 2, text: ocr[2], ocr: true }], "Manual");
assert.equal(secs.length, 1); assert.match(secs[0].path, /CHAPTER 4 INFUSION THERAPY, page 1 \(scanned\)/); ok("builds sections, skips blank pages, keeps headings");
// HTML + Markdown
const { md } = htmlToMarkdown("<html><title>Guide</title><body><nav>x</nav><main><h2>Placing an order</h2><p>Select <b>Orders</b>.</p><ul><li>Routine</li><li>STAT</li></ul></main></body></html>");
assert.match(md, /## Placing an order/); assert.match(md, /- STAT/); ok("converts saved web pages");
const mdSecs = chunkMarkdown("# Pump\n\n## Alarms\n\nOcclusion downstream: check clamps.\n\n## Error codes\n\nE-21 pressure sensor fault.", "Pump");
assert.equal(mdSecs.length, 2); ok("splits Markdown by headings");
// Search
const sources = new Map([["sabcdefgh", { id: "sabcdefgh", title: "Pump manual", category: "equipment" }], ["sijkmnpqr", { id: "sijkmnpqr", title: "Guide rapide", category: "protocol" }]]);
const chunks = [
  ...mdSecs.map((s, i) => ({ id: `sabcdefgh.${i + 1}`, srcId: "sabcdefgh", ...s })),
  { id: "sijkmnpqr.1", srcId: "sijkmnpqr", path: "Pannes", text: "En cas de code E-21, retirer la pompe de réanimation." }
];
const ix = buildIndex(chunks, sources);
assert.equal(search(ix, "What does error E-21 mean?")[0].c.id, "sabcdefgh.2"); ok("finds error codes");
assert.ok(search(ix, "reanimation pompe").some(r => r.c.id === "sijkmnpqr.1")); ok("matches French without accents");
// Citations
const ids = [..."Do this [sabcdefgh.2, sijkmnpqr.1] and [sabcdefgh.1].".matchAll(CITE_RE)].flatMap(m => m[1].split(/\s*,\s*/));
assert.deepEqual(ids, ["sabcdefgh.2", "sijkmnpqr.1", "sabcdefgh.1"]); ok("parses citations");
console.log(`\nAll ${n} checks passed.`);
