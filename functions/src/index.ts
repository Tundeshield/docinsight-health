// DocInsight Health Cloud Functions (europe-west1).
import { dispatcher, standalone, type Handler } from "./lib/fn";
import * as institutions from "./api/institutions";
import * as spaces from "./api/spaces";
import * as members from "./api/members";
import * as content from "./api/content";
import * as ai from "./api/ai";
import * as billing from "./api/billing";
import * as analytics from "./api/analytics";
import * as platform from "./api/platform";

const all: Record<string, unknown> = { ...institutions, ...spaces, ...members, ...content, ...ai, ...billing, ...analytics, ...platform };
const handlers = Object.fromEntries(Object.entries(all).filter(([, v]) => (v as Handler)?.__callable)) as Record<string, Handler>;

/** Every ordinary call: { action, payload } */
export const api = dispatcher(handlers);
/** Search gets its own warm container: it is used constantly. */
export const searchDocs = standalone(ai.search, "search");

export { ask } from "./api/ai";
export { paystackWebhook } from "./api/billing";
export { health } from "./api/platform";
export { ingestTask } from "./pipeline/ingest";
export { publishTask } from "./pipeline/publish";
export { dailyBilling, reviewReminders, hourlyHousekeeping, weeklyDigest } from "./jobs/scheduled";
