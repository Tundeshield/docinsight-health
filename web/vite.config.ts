import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "DocInsight Health",
        short_name: "DocInsight",
        description: "Your hospital's protocols in every staff member's pocket, with answers you can trust.",
        theme_color: "#12302A",
        background_color: "#F3F6F5",
        display: "standalone",
        start_url: "/app",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/__/, /^\/firebase-messaging-sw\.js$/],
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        runtimeCaching: [
          { urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//, handler: "CacheFirst", options: { cacheName: "fonts", expiration: { maxEntries: 20, maxAgeSeconds: 31_536_000 } } },
        ],
      },
    }),
  ],
  server: { fs: { allow: [".."] } },
  build: {
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore", "firebase/functions", "firebase/storage"],
          react: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
