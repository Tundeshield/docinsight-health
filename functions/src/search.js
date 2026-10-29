// BM25 keyword search, aware of identifiers, error codes and French accents.
const STOP = new Set(("a an and are as at be but by can do does for from has have how i if in into is it its of on or our so that the their then there these this to was we what when where which who why will with you your use using used " +
  "le la les de des du un une et en pour dans que qui est sur au aux avec par ce cette ces comment quoi quel quelle quels quelles je il elle nous vous ils on ne pas plus se sa son ses leur leurs ou mais donc").split(" "));

function stem(w) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 3 && /[sx]$/.test(w) && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokenize(str) {
  const out = []; const raw = String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[A-Za-z0-9_]+/g) || [];
  for (const w of raw) {
    const l = w.toLowerCase();
    if ((l.length > 1 || /\d/.test(l)) && !STOP.has(l)) out.push(stem(l));
    if (/[a-z][A-Z]|_/.test(w)) for (const p of w.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[ _]+/)) {
      const pl = p.toLowerCase(); if (pl.length > 1 && !STOP.has(pl) && pl !== l) out.push(stem(pl));
    }
  }
  return out;
}

/** chunks: [{id, srcId, path, text}], sources: Map(srcId → meta) */
export function buildIndex(chunks, sources) {
  const docs = []; const df = new Map(); let total = 0;
  for (const c of chunks) {
    const src = sources.get(c.srcId); if (!src) continue;
    const toks = tokenize(`${src.title} ${src.area || ""} ${c.path} ${c.path} ${c.text}`);
    const tf = new Map(); for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    docs.push({ c, src, tf, len: toks.length, lower: c.text.toLowerCase() }); total += toks.length;
  }
  return { docs, df, N: docs.length, avg: docs.length ? total / docs.length : 1 };
}

export function search(ix, query, { category = "any", limit = 6 } = {}) {
  if (!ix || !ix.N) return [];
  const qt = [...new Set(tokenize(query))]; if (!qt.length) return [];
  const k1 = 1.2, b = 0.75; const ql = String(query).toLowerCase().trim(); const res = [];
  for (const d of ix.docs) {
    if (category !== "any" && d.src.category !== category) continue;
    let s = 0;
    for (const t of qt) {
      const f = d.tf.get(t); if (!f) continue;
      const n = ix.df.get(t) || 0; const idf = Math.log(1 + (ix.N - n + 0.5) / (n + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / ix.avg));
    }
    if (s > 0 && ql.length > 6 && d.lower.includes(ql)) s += 2;
    if (s > 0) res.push({ c: d.c, src: d.src, score: s });
  }
  return res.sort((a, b) => b.score - a.score).slice(0, limit);
}
