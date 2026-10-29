// Deployment settings. Secrets are set with `firebase functions:secrets:set NAME`.
import { defineSecret, defineString } from "firebase-functions/params";

export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
export const PAYSTACK_SECRET_KEY = defineSecret("PAYSTACK_SECRET_KEY");
export const APP_URL = defineString("APP_URL", { default: "http://localhost:5173" });
export const CLAUDE_MODEL = defineString("CLAUDE_MODEL", { default: "claude-sonnet-5-5" });

// europe-west1 has good connectivity to Lagos. Keep Firestore, Storage and Functions together.
export const REGION = "europe-west1";

export const CATEGORIES = {
  protocol: "Protocol or SOP",
  equipment: "Equipment manual",
  policy: "Policy or regulation",
  billing: "Insurance or billing",
  system: "Software or system guide"
};
