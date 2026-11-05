// Retrieval (PRD section 7): the allowed set (institution, visible spaces, active approved
// versions, enabled hub collections) is applied inside each query, never after it.
import type { Chunk } from "../../../shared/src/types";
import { buildBm25, rrf, searchBm25, type Bm25Index } from "../../../shared/src/text";
import { db, FieldValue } from "../lib/admin";
import { embed } from "../pipeline/embed";

export interface Scope { instId: string; spaceIds: string[]; hubCollectionIds: string[]; instCorpus: number; hubCorpus: number }
export type LiteChunk = Omit<Chunk, "embedding" | "createdAt">;
export interface Retrieved { chunk: LiteChunk; semantic: number | null; keyword: number | null; score: number }

const FIELDS = ["contentId", "versionId", "spaceId", "sectionId", "title", "versionNumber", "documentType", "pages", "pageLabels", "headingPath", "text", "wordCount", "ocr", "active", "source", "effectiveDate", "language"];

const corpusCache = new Map<string, { version: number; chunks: Map<string, LiteChunk>; bm25: Bm25Index }>();

async function corpus(key: string, version: number, col: FirebaseFirestore.CollectionReference) {
  const hit = corpusCache.get(key);
  if (hit && hit.version === version) return hit;
  const snap = await col.where("active", "==", true).select(...FIELDS).get();
  const chunks = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() } as LiteChunk]));
  const bm25 = buildBm25([...chunks.values()].map((c) => ({ id: c.id, text: `${c.title} ${c.title} ${c.headingPath} ${c.text}` })));
  const entry = { version, chunks, bm25 };
  corpusCache.set(key, entry);
  if (corpusCache.size > 40) corpusCache.delete(corpusCache.keys().next().value!);
  return entry;
}

async function nearest(col: FirebaseFirestore.CollectionReference, spaceId: string, vector: number[], limit: number) {
  const snap = await col.where("active", "==", true).where("spaceId", "==", spaceId)
    .findNearest({ vectorField: "embedding", queryVector: FieldValue.vector(vector), limit, distanceMeasure: "COSINE", distanceResultField: "_distance" })
    .get();
  return snap.docs.map((d) => {
    const { embedding: _e, _distance, ...rest } = d.data();
    return { chunk: { id: d.id, ...rest } as LiteChunk, distance: Number(_distance) };
  });
}

export async function retrieve(scope: Scope, query: string, k = 20): Promise<Retrieved[]> {
  const instCol = db.collection(`institutions/${scope.instId}/chunks`);
  const hubCol = db.collection("hubChunks");
  const spaceSet = new Set(scope.spaceIds), hubSet = new Set(scope.hubCollectionIds);
  const [[vector], inst, hub] = await Promise.all([
    embed([query], "RETRIEVAL_QUERY"),
    corpus(`inst:${scope.instId}`, scope.instCorpus, instCol),
    scope.hubCollectionIds.length ? corpus("hub", scope.hubCorpus, hubCol) : Promise.resolve(null),
  ]);
  // Semantic: one vector query per allowed space / hub collection, each filtered in the query
  const per = Math.max(4, Math.min(12, Math.ceil(40 / Math.max(1, scope.spaceIds.length + scope.hubCollectionIds.length))));
  const sem = (await Promise.all([
    ...scope.spaceIds.slice(0, 40).map((s) => nearest(instCol, s, vector, per)),
    ...scope.hubCollectionIds.slice(0, 20).map((h) => nearest(hubCol, h, vector, per)),
  ])).flat().sort((a, b) => a.distance - b.distance).slice(0, k);
  // Keyword: BM25 over the active corpus, restricted to the same allowed set
  const kwInst = searchBm25(inst.bm25, query, k, (id) => spaceSet.has(inst.chunks.get(id)?.spaceId ?? ""));
  const kwHub = hub ? searchBm25(hub.bm25, query, k, (id) => hubSet.has(hub.chunks.get(id)?.spaceId ?? "")) : [];
  const kw = [...kwInst.map((x) => ({ ...x, id: `i:${x.id}` })), ...kwHub.map((x) => ({ ...x, id: `h:${x.id}` }))].sort((a, b) => b.score - a.score).slice(0, k);
  const semIds = sem.map((s) => `${s.chunk.source === "hub" ? "h" : "i"}:${s.chunk.id}`);
  const fused = rrf([semIds, kw.map((x) => x.id)]).slice(0, k);
  const semMap = new Map(sem.map((s) => [`${s.chunk.source === "hub" ? "h" : "i"}:${s.chunk.id}`, s]));
  const kwMap = new Map(kw.map((x) => [x.id, x.score]));
  return fused.map((f) => {
    const s = semMap.get(f.id);
    const [kind, cid] = [f.id.slice(0, 1), f.id.slice(2)];
    const chunk = s?.chunk ?? (kind === "h" ? hub!.chunks.get(cid)! : inst.chunks.get(cid)!);
    return { chunk, semantic: s ? 1 - s.distance : null, keyword: kwMap.get(f.id) ?? null, score: f.score };
  }).filter((r) => r.chunk && (r.chunk.source === "hub" ? hubSet.has(r.chunk.spaceId) : spaceSet.has(r.chunk.spaceId)));
}
