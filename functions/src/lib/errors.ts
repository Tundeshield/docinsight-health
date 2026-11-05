import { HttpsError } from "firebase-functions/v2/https";

export const fail = {
  auth: () => new HttpsError("unauthenticated", "Sign in to continue."),
  denied: (msg = "You don't have permission to do this.") => new HttpsError("permission-denied", msg),
  invalid: (msg: string) => new HttpsError("invalid-argument", msg),
  notFound: (msg = "That item no longer exists.") => new HttpsError("not-found", msg),
  precondition: (msg: string, details?: Record<string, unknown>) => new HttpsError("failed-precondition", msg, details),
  limit: (msg: string, details?: Record<string, unknown>) => new HttpsError("resource-exhausted", msg, details),
  unavailable: (msg = "This service is busy. Try again in a moment.") => new HttpsError("unavailable", msg),
};

export const str = (v: unknown, max = 200, field = "value"): string => {
  if (v == null) return "";
  if (typeof v !== "string") throw fail.invalid(`${field} must be text.`);
  return v.trim().slice(0, max);
};
export const reqStr = (v: unknown, max = 200, field = "value"): string => {
  const s = str(v, max, field);
  if (!s) throw fail.invalid(`Enter ${field}.`);
  return s;
};
export const strList = (v: unknown, maxItems = 200, maxLen = 200): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => (x as string).trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems) : [];
export const bool = (v: unknown, d = false) => (typeof v === "boolean" ? v : d);
export const dateStr = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
export const id = (v: unknown, field = "id"): string => {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) throw fail.invalid(`Invalid ${field}.`);
  return v;
};
export const oneOf = <T extends string>(v: unknown, options: readonly T[], d: T): T => (options.includes(v as T) ? (v as T) : d);
