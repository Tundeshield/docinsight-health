// Loads an organisation's ready documents and keeps an in-memory search index per function instance.
import { db, bucket } from "./admin.js";
import { buildIndex } from "./search.js";

const cache = new Map(); // orgId -> { version, corpus }

export const overdue = (src) => !!src.reviewDate && new Date(src.reviewDate + "T23:59:59Z") < new Date();

export async function loadCorpus(orgId, version) {
  const hit = cache.get(orgId);
  if (hit && hit.version === version) return hit.corpus;
  const snap = await db.collection(`orgs/${orgId}/sources`).where("status", "==", "ready").get();
  const sources = new Map(); const chunks = [];
  await Promise.all(snap.docs.map(async d => {
    const meta = { id: d.id, ...d.data() };
    try {
      const [buf] = await bucket().file(`orgs/${orgId}/sources/${d.id}/chunks.json`).download();
      const list = JSON.parse(buf.toString("utf8"));
      sources.set(d.id, { ...meta, chunkCount: list.length });
      for (const c of list) chunks.push(c);
    } catch (e) { console.warn("chunks missing", orgId, d.id, e.message); }
  }));
  const ordered = [...sources.values()].sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
  const byId = new Map(chunks.map(c => [c.id, c]));
  const corpus = { sources, ordered, chunks, byId, index: buildIndex(chunks, sources) };
  cache.set(orgId, { version, corpus });
  if (cache.size > 50) cache.delete(cache.keys().next().value);
  return corpus;
}

export function neighbour(corpus, id, d) {
  const [s, n] = id.split("."); const k = `${s}.${+n + d}`;
  return corpus.byId.has(k) ? k : null;
}
