// The document pipeline serves two owners: a hospital (institution) and the national Knowledge Hub.
import { db } from "./admin";

export type Scope = { kind: "inst"; instId: string } | { kind: "hub" };
export const scopeOf = (instId: string): Scope => (instId === "hub" ? { kind: "hub" } : { kind: "inst", instId });
export const scopeKey = (s: Scope) => (s.kind === "hub" ? "hub" : s.instId);

export const contentCol = (s: Scope) => (s.kind === "hub" ? db.collection("hubContent") : db.collection(`institutions/${s.instId}/content`));
export const contentRef = (s: Scope, cid: string) => contentCol(s).doc(cid);
export const versionRef = (s: Scope, cid: string, vid: string) => contentRef(s, cid).collection("versions").doc(vid);
export const chunksCol = (s: Scope) => (s.kind === "hub" ? db.collection("hubChunks") : db.collection(`institutions/${s.instId}/chunks`));

export const paths = {
  upload: (s: Scope, cid: string, vid: string, file: string) => (s.kind === "hub" ? `hubUploads/${cid}/${vid}/${file}` : `inst/${s.instId}/uploads/${cid}/${vid}/${file}`),
  uploadPrefix: (s: Scope, cid: string, vid: string) => (s.kind === "hub" ? `hubUploads/${cid}/${vid}/` : `inst/${s.instId}/uploads/${cid}/${vid}/`),
  draft: (s: Scope, cid: string, vid: string) => (s.kind === "hub" ? `hubDrafts/${cid}/${vid}/` : `inst/${s.instId}/drafts/${cid}/${vid}/`),
  published: (s: Scope, spaceId: string, cid: string, vid: string) => (s.kind === "hub" ? `hub/${spaceId}/${cid}/${vid}/` : `inst/${s.instId}/published/${spaceId}/${cid}/${vid}/`),
};
