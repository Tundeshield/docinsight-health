import { logger } from "firebase-functions";
import { db, messaging } from "./admin";
import { APP_URL } from "./params";

/** Web push to every registered device of these users. Invalid tokens are removed. */
export async function pushTo(userIds: string[], title: string, body: string, path: string): Promise<number> {
  const tokens: { uid: string; token: string }[] = [];
  for (let i = 0; i < userIds.length; i += 30) {
    const group = userIds.slice(i, i + 30);
    const snaps = await Promise.all(group.map((u) => db.collection(`users/${u}/tokens`).get()));
    snaps.forEach((s, j) => s.docs.forEach((d) => tokens.push({ uid: group[j], token: d.data().token })));
  }
  if (!tokens.length) return 0;
  let sent = 0;
  for (let i = 0; i < tokens.length; i += 500) {
    const part = tokens.slice(i, i + 500);
    try {
      const res = await messaging().sendEachForMulticast({
        tokens: part.map((t) => t.token),
        notification: { title, body },
        webpush: { fcmOptions: { link: `${APP_URL.value()}${path}` }, notification: { icon: "/icon-192.png", badge: "/icon-192.png" } },
        data: { path },
      });
      sent += res.successCount;
      await Promise.all(res.responses.map((r, j) => {
        const code = r.error?.code ?? "";
        if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
          return db.doc(`users/${part[j].uid}/tokens/${part[j].token}`).delete().catch(() => {});
        }
        return null;
      }));
    } catch (e) {
      logger.warn("push failed", { err: (e as Error).message });
    }
  }
  return sent;
}
