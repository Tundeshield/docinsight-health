import { defineSecret, defineString } from "firebase-functions/params";

export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
export const PAYSTACK_SECRET_KEY = defineSecret("PAYSTACK_SECRET_KEY");
export const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
export const SENTRY_DSN = defineSecret("SENTRY_DSN");

export const APP_URL = defineString("APP_URL", { default: "https://docinsight-health.netlify.app" });
export const EMAIL_FROM = defineString("EMAIL_FROM", { default: "DocInsight Health <onboarding@resend.dev>" });
export const ANSWER_MODEL = defineString("ANSWER_MODEL", { default: "claude-sonnet-5-5" });
export const FAST_MODEL = defineString("FAST_MODEL", { default: "claude-haiku-5-5" });
export const DOCAI_PROCESSOR = defineString("DOCAI_PROCESSOR", { default: "" }); // projects/…/locations/eu/processors/…
export const EMBEDDING_MODEL = defineString("EMBEDDING_MODEL", { default: "text-multilingual-embedding-002" });

/** Secrets that hold a placeholder ("unset") are treated as not configured. */
export function secretValue(s: { value(): string }): string | null {
  try {
    const v = s.value();
    return v && v !== "unset" ? v : null;
  } catch {
    return null;
  }
}
