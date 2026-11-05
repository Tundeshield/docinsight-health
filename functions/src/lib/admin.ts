import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import { getFunctions } from "firebase-admin/functions";

if (!getApps().length) initializeApp();
export const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
export const bucket = () => getStorage().bucket();
export const adminAuth = () => getAuth();
export const messaging = () => getMessaging();
export const taskQueue = (name: string) => getFunctions().taskQueue(`locations/europe-west1/functions/${name}`);
export { FieldValue, Timestamp };

export const now = () => Timestamp.now();
export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
export const toDate = (t: unknown): Date | null => (t instanceof Timestamp ? t.toDate() : t instanceof Date ? t : null);

export function randomId(len = 10, alphabet = "abcdefghijkmnpqrstuvwxyz23456789"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export const inst = (id: string) => db.doc(`institutions/${id}`);
export const instCol = (id: string, col: string) => db.collection(`institutions/${id}/${col}`);
export const memberRef = (instId: string, uid: string) => db.doc(`institutions/${instId}/members/${uid}`);

/** Writes in batches of 400 operations. */
export async function batchWrite(ops: ((b: FirebaseFirestore.WriteBatch) => void)[]): Promise<void> {
  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch();
    ops.slice(i, i + 400).forEach((op) => op(b));
    await b.commit();
  }
}

export async function deleteCollection(ref: FirebaseFirestore.CollectionReference | FirebaseFirestore.Query, pageSize = 300): Promise<number> {
  let n = 0;
  for (;;) {
    const snap = await ref.limit(pageSize).get();
    if (snap.empty) return n;
    const b = db.batch();
    snap.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
    n += snap.size;
  }
}

export type DocRef = DocumentReference;
