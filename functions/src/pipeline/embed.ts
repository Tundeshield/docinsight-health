// Embeddings with Vertex AI in the project's own region. Cached per text hash.
import { GoogleAuth } from "google-auth-library";
import { createHash } from "node:crypto";
import { EMBEDDING_MODEL } from "../lib/params";

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
export const EMBEDDING_DIM = 768;
const LOCATION = "europe-west1";
const cache = new Map<string, number[]>();

async function project(): Promise<string> {
  return process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || (await auth.getProjectId());
}

export async function embed(texts: string[], task: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY", titles?: string[]): Promise<number[][]> {
  const out: number[][] = new Array(texts.length);
  const todo: number[] = [];
  texts.forEach((t, i) => {
    const key = createHash("sha256").update(task + "|" + (titles?.[i] ?? "") + "|" + t).digest("hex");
    const hit = cache.get(key);
    if (hit) out[i] = hit; else todo.push(i);
  });
  const p = await project();
  const client = await auth.getClient();
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${p}/locations/${LOCATION}/publishers/google/models/${EMBEDDING_MODEL.value()}:predict`;
  for (let i = 0; i < todo.length; i += 16) {
    const idx = todo.slice(i, i + 16);
    const body = { instances: idx.map((j) => ({ content: texts[j].slice(0, 8000), task_type: task, ...(titles?.[j] && task === "RETRIEVAL_DOCUMENT" ? { title: titles[j] } : {}) })), parameters: { outputDimensionality: EMBEDDING_DIM, autoTruncate: true } };
    let attempt = 0;
    for (;;) {
      const t = await client.getAccessToken();
      const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) {
        const json = (await res.json()) as { predictions: { embeddings: { values: number[] } }[] };
        json.predictions.forEach((pr, k) => {
          const j = idx[k];
          out[j] = pr.embeddings.values;
          const key = createHash("sha256").update(task + "|" + (titles?.[j] ?? "") + "|" + texts[j]).digest("hex");
          if (cache.size > 5000) cache.clear();
          cache.set(key, out[j]);
        });
        break;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 4) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt++)); continue; }
      throw new Error(`Embedding failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  }
  return out;
}
