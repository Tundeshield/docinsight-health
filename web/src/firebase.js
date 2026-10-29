import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

const env = import.meta.env;
// Firebase web settings are public identifiers, not secrets (access is enforced by the security rules).
// These defaults keep the site working if the Netlify environment variables are missing.
const DEFAULTS = {
  apiKey: "AIzaSyAcEqB04XfQbyXw2kgibQSYgnp8sUQ8zr0",
  authDomain: "docinsight-health.firebaseapp.com",
  projectId: "docinsight-health",
  storageBucket: "docinsight-health.firebasestorage.app",
  messagingSenderId: "624234745329",
  appId: "1:624234745329:web:2edaebd36a228ab1edc850",
  measurementId: "G-V1Y1Q4EJYY"
};
export const app = initializeApp({
  ...DEFAULTS,
  ...(env.VITE_FIREBASE_API_KEY && {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    appId: env.VITE_FIREBASE_APP_ID
  })
});
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, env.VITE_FUNCTIONS_REGION || "europe-west1");
export const ASK_URL = env.VITE_ASK_URL || "https://europe-west1-docinsight-health.cloudfunctions.net/ask";

if (env.VITE_USE_EMULATORS === "true") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
