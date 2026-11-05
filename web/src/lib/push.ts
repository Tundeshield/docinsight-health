// Push notifications through Firebase Cloud Messaging. Needs a VAPID key in the Netlify
// environment (VITE_FIREBASE_VAPID_KEY); without it the app falls back to in-app and email.
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { app, db } from "./firebase";

export const pushAvailable = () => typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && !!import.meta.env.VITE_FIREBASE_VAPID_KEY;

export async function registerPush(uid: string): Promise<boolean> {
  if (!pushAvailable()) return false;
  if (Notification.permission === "denied") return false;
  if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") return false;
  const { getMessaging, getToken, isSupported } = await import("firebase/messaging");
  if (!(await isSupported())) return false;
  const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/firebase-cloud-messaging-push-scope" });
  const token = await getToken(getMessaging(app), { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) return false;
  await setDoc(doc(db, "users", uid, "tokens", token.slice(-40).replace(/[^\w-]/g, "_")), { token, platform: "web", updatedAt: serverTimestamp() });
  return true;
}
