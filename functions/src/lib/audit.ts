import type { AuditAction } from "../../../shared/src/types";
import { db, FieldValue } from "./admin";

export interface AuditInput {
  instId: string;
  actorId: string;
  actorName: string;
  action: AuditAction;
  target: { type: string; id: string; title?: string };
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

const clean = (o: Record<string, unknown> | null | undefined) =>
  o ? JSON.parse(JSON.stringify(o, (_k, v) => (v && typeof v === "object" && "_seconds" in v ? new Date(v._seconds * 1000).toISOString() : v))) : null;

/** Appends to the institution's audit log (retained at least 3 years; never edited). */
export async function audit(e: AuditInput, batch?: FirebaseFirestore.WriteBatch | FirebaseFirestore.Transaction): Promise<void> {
  const ref = db.collection(`institutions/${e.instId}/auditLog`).doc();
  const data = { id: ref.id, actorId: e.actorId, actorName: e.actorName, action: e.action, target: e.target, before: clean(e.before), after: clean(e.after), at: FieldValue.serverTimestamp() };
  if (batch) (batch as FirebaseFirestore.WriteBatch).set(ref, data);
  else await ref.set(data);
}

/** Before/after of only the fields that changed. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {}, a: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) { b[k] = before[k] ?? null; a[k] = after[k] ?? null; }
  }
  return { before: b, after: a };
}
