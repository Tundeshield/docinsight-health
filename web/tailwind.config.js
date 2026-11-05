/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      fontFamily: { sans: ['"Atkinson Hyperlegible"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"], mono: ["ui-monospace", "Menlo", "Consolas", "monospace"] },
      colors: {
        ink: { DEFAULT: "rgb(var(--ink) / <alpha-value>)", 2: "rgb(var(--ink-2) / <alpha-value>)" },
        page: "rgb(var(--page) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        rule: "rgb(var(--rule) / <alpha-value>)",
        soft: "rgb(var(--soft) / <alpha-value>)",
        brand: "rgb(var(--brand) / <alpha-value>)",
        teal: "rgb(var(--teal) / <alpha-value>)",
        warn: { DEFAULT: "rgb(var(--warn) / <alpha-value>)", bg: "rgb(var(--warn-bg) / <alpha-value>)" },
        ok: { DEFAULT: "rgb(var(--ok) / <alpha-value>)", bg: "rgb(var(--ok-bg) / <alpha-value>)" },
        hub: "rgb(var(--hub) / <alpha-value>)",
      },
      maxWidth: { content: "72rem" },
    },
  },
  plugins: [],
};
