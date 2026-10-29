import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Firebase and React go in their own long-cached chunks, so returning staff on mobile data
// only download the (small) app code after an update.
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { output: { manualChunks: { firebase: ["firebase/app", "firebase/auth", "firebase/firestore", "firebase/storage", "firebase/functions"], react: ["react", "react-dom", "react-router-dom"] } } }, chunkSizeWarningLimit: 700 }
});
