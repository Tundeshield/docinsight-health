import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

// Firebase web settings are public identifiers, not secrets: the security rules protect the data.
const env = import.meta.env;
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyAcEqB04XfQbyXw2kgibQSYgnp8sUQ8zr0",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "docinsight-health.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "docinsight-health",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "docinsight-health.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "624234745329",
  appId: env.VITE_FIREBASE_APP_ID || "1:624234745329:web:2edaebd36a228ab1edc850",
};
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Offline-capable cache: lists and documents seen before still open without a network.
export const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
export const storage = getStorage(app);
export const functions = getFunctions(app, "europe-west1");

if (env.VITE_USE_EMULATORS === "true") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
