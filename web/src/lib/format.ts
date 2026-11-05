import type { Timestamp } from "firebase/firestore";
export { formatMoney, STATUS_LABEL } from "../../../shared/src/billing";

export const toDate = (t: unknown): Date | null => {
  if (!t) return null;
  if (t instanceof Date) return t;
  if (typeof t === "string") return new Date(t);
  if (typeof (t as Timestamp).toDate === "function") return (t as Timestamp).toDate();
  return null;
};
export const fmtDate = (t: unknown) => { const d = toDate(t) ?? (typeof t === "string" ? new Date(t + "T12:00:00") : null); return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""; };
export const fmtDateTime = (t: unknown) => { const d = toDate(t); return d ? d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; };
export const ago = (t: unknown) => {
  const d = toDate(t); if (!d) return "";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`; return fmtDate(d);
};
export const isOverdue = (ymd: string | null | undefined) => !!ymd && ymd < new Date().toISOString().slice(0, 10);
export const daysUntil = (ymd: string | null | undefined) => (ymd ? Math.ceil((new Date(ymd + "T00:00:00").getTime() - Date.now()) / 86_400_000) : null);
export const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString()} ${n === 1 ? one : many}`;
