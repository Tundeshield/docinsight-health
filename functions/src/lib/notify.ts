import type { Member, NotificationRecord } from "../../../shared/src/types";
import { db, FieldValue } from "./admin";
import { sendEmail, type Email } from "./email";
import { pushTo } from "./push";
import { APP_URL } from "./params";

export async function membersWhere(instId: string, filter: (m: Member) => boolean): Promise<Member[]> {
  const snap = await db.collection(`institutions/${instId}/members`).where("status", "==", "active").get();
  return snap.docs.map((d) => ({ ...d.data(), userId: d.id }) as Member).filter(filter);
}

export const managers = (instId: string) => membersWhere(instId, (m) => m.role === "owner" || m.role === "admin");

/** Push + email (+ in-app record) to a set of members. */
export async function notify(instId: string, type: NotificationRecord["type"], members: Member[], msg: { title: string; body: string; path: string; email?: Omit<Email, "to"> }, contentId: string | null = null): Promise<void> {
  if (!members.length) return;
  const ids = members.map((m) => m.userId);
  const channels: NotificationRecord["channels"] = ["in_app"];
  const pushed = await pushTo(ids, msg.title, msg.body, msg.path);
  if (pushed) channels.push("push");
  if (msg.email) {
    const ok = await sendEmail({ ...msg.email, to: members.map((m) => m.email).filter(Boolean), button: msg.email.button ?? { label: "Open DocInsight", url: `${APP_URL.value()}${msg.path}` } });
    if (ok) channels.push("email");
  }
  const ref = db.collection(`institutions/${instId}/notifications`).doc();
  await ref.set({ id: ref.id, type, contentId, recipients: ids.slice(0, 500), channels, sentAt: FieldValue.serverTimestamp() });
}
