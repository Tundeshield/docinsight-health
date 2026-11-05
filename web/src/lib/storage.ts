// Page images and text are read through the SDK (no shareable links) and kept on the device
// so documents opened once, or saved for offline, still open without a network.
import { ref, getBlob, getBytes } from "firebase/storage";
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys, createStore } from "idb-keyval";
import { storage } from "./firebase";
import type { PageText } from "../../../shared/src/types";

const files = createStore("docinsight-files", "files");
const meta = createStore("docinsight-offline", "docs");

export interface OfflineDoc { key: string; contentId: string; versionId: string; title: string; spaceName: string; base: string; pages: number; savedAt: number; bytes: number }

/** Folder holding a version's processed pages. */
/** Page images exist for PDFs and photos; Word files, in-app pages and checklists are text only. */
export const hasPageImages = (type: string, pages: PageText[]) => type === "image" || (type === "file" && !!pages.length && !/^Part /.test(pages[0].label));

export function versionBase(opts: { instId: string; hub?: boolean; spaceId: string; contentId: string; versionId: string; draft?: boolean }): string {
  if (opts.hub) return opts.draft ? `hubDrafts/${opts.contentId}/${opts.versionId}/` : `hub/${opts.spaceId}/${opts.contentId}/${opts.versionId}/`;
  return opts.draft ? `inst/${opts.instId}/drafts/${opts.contentId}/${opts.versionId}/` : `inst/${opts.instId}/published/${opts.spaceId}/${opts.contentId}/${opts.versionId}/`;
}

async function cachedBlob(path: string, keep = true): Promise<Blob> {
  const hit = await idbGet<Blob>(path, files).catch(() => undefined);
  if (hit) return hit;
  const b = await getBlob(ref(storage, path));
  if (keep) idbSet(path, b, files).catch(() => undefined);
  return b;
}

export async function loadText(base: string): Promise<PageText[]> {
  const key = base + "text.json";
  const hit = await idbGet<PageText[]>(key, files).catch(() => undefined);
  if (hit && !navigator.onLine) return hit;
  try {
    const bytes = await getBytes(ref(storage, key));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { pages: PageText[] } | PageText[];
    const pages = Array.isArray(parsed) ? parsed : parsed.pages;
    idbSet(key, pages, files).catch(() => undefined);
    return pages;
  } catch (e) {
    if (hit) return hit;
    throw e;
  }
}

const urls = new Map<string, string>();
export async function pageImageUrl(base: string, n: number, thumb = false): Promise<string> {
  const path = `${base}${thumb ? "thumbs" : "pages"}/${n}.jpg`;
  const u = urls.get(path);
  if (u) return u;
  const url = URL.createObjectURL(await cachedBlob(path));
  urls.set(path, url);
  return url;
}

export async function downloadFile(path: string, filename: string) {
  const b = await getBlob(ref(storage, path));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

export async function saveOffline(d: Omit<OfflineDoc, "key" | "savedAt" | "bytes">, onProgress?: (done: number, total: number) => void) {
  let bytes = 0;
  await loadText(d.base);
  for (let n = 1; n <= d.pages; n++) {
    const b = await cachedBlob(`${d.base}pages/${n}.jpg`);
    bytes += b.size;
    onProgress?.(n, d.pages);
  }
  const rec: OfflineDoc = { ...d, key: d.contentId, savedAt: Date.now(), bytes };
  await idbSet(d.contentId, rec, meta);
  return rec;
}

export async function offlineDocs(): Promise<OfflineDoc[]> {
  const ks = await idbKeys(meta).catch(() => []);
  const out: OfflineDoc[] = [];
  for (const k of ks) { const v = await idbGet<OfflineDoc>(k, meta); if (v) out.push(v); }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}
export async function isOffline(contentId: string) { return !!(await idbGet(contentId, meta).catch(() => undefined)); }
export async function removeOffline(contentId: string) {
  const rec = await idbGet<OfflineDoc>(contentId, meta);
  if (rec) {
    for (let n = 1; n <= rec.pages; n++) await idbDel(`${rec.base}pages/${n}.jpg`, files).catch(() => undefined);
    await idbDel(rec.base + "text.json", files).catch(() => undefined);
  }
  await idbDel(contentId, meta);
}
