import type { PageText } from "../../../shared/src/types";
import { bucket } from "../lib/admin";

export async function readJson<T>(path: string): Promise<T | null> {
  const f = bucket().file(path);
  const [exists] = await f.exists();
  if (!exists) return null;
  const [buf] = await f.download();
  return JSON.parse(buf.toString("utf8")) as T;
}
export async function writeJson(path: string, data: unknown): Promise<void> {
  await bucket().file(path).save(JSON.stringify(data), { contentType: "application/json", resumable: false, metadata: { cacheControl: "private, max-age=300" } });
}
export async function writeBytes(path: string, buf: Buffer, contentType: string): Promise<void> {
  await bucket().file(path).save(buf, { contentType, resumable: false, metadata: { cacheControl: "private, max-age=31536000" } });
}
export async function copyPrefix(from: string, to: string): Promise<number> {
  const [files] = await bucket().getFiles({ prefix: from });
  await Promise.all(files.filter((f) => !f.name.endsWith("work.json")).map((f) => f.copy(bucket().file(to + f.name.slice(from.length)))));
  return files.length;
}
export async function deletePrefix(prefix: string): Promise<void> {
  await bucket().deleteFiles({ prefix, force: true }).catch(() => {});
}
export type TextFile = { pages: PageText[]; title: string; language: string };
