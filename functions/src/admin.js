import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getAuth } from "firebase-admin/auth";
import { getFunctions } from "firebase-admin/functions";

if (!getApps().length) initializeApp();
export const db = getFirestore();
export const bucket = () => getStorage().bucket();
export const adminAuth = getAuth();
export const taskQueue = (name) => getFunctions().taskQueue(name);
export { FieldValue };

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
export const randomId = (len = 8, alphabet = "abcdefghijkmnpqrstuvwxyz23456789") => {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
};
