import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import type { Citation, AnswerStatus } from "../../../shared/src/types";

export class ApiError extends Error {
  constructor(message: string, public code: string, public details?: Record<string, unknown>) { super(message); }
}

function wrap(e: unknown): ApiError {
  const err = e as { message?: string; code?: string; details?: Record<string, unknown> };
  const code = String(err.code ?? "").replace("functions/", "");
  const msg = !err.message || /^(internal|INTERNAL)$/.test(err.message)
    ? "Something went wrong. Try again in a moment."
    : code === "unavailable" && /fetch|network/i.test(err.message) ? "No connection. Check your internet and try again." : err.message;
  return new ApiError(msg, code, err.details);
}

const apiFn = httpsCallable<{ action: string; payload: unknown }, unknown>(functions, "api", { timeout: 300_000 });

/** Calls a server action. Errors carry a message written for the person using the app. */
export async function api<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  try {
    return (await apiFn({ action, payload })).data as T;
  } catch (e) {
    throw wrap(e);
  }
}

export interface SearchResult {
  contentId: string; title: string; source: "hospital" | "hub"; label: string; spaceId: string; spaceName: string; sectionId: string | null;
  documentType: string; page: number; pageLabel: string; heading: string; snippet: string; versionNumber: number | null;
}
const searchFn = httpsCallable<Record<string, unknown>, { results: SearchResult[] }>(functions, "searchDocs", { timeout: 60_000 });
export async function search(instId: string, q: string, filters: Record<string, unknown> = {}) {
  try { return (await searchFn({ instId, q, filters })).data.results; } catch (e) { throw wrap(e); }
}

export interface AskResult { questionId: string | null; status: AnswerStatus; answer: string; citations: Citation[]; message?: string; cached?: boolean }
const askFn = httpsCallable<Record<string, unknown>, AskResult, { status: string }>(functions, "ask", { timeout: 120_000 });

/** Asks DocInsight, reporting progress ("Searching…", "Checking every claim has a source…"). */
export async function ask(instId: string, question: string, onStatus: (s: string) => void): Promise<AskResult> {
  try {
    const { stream, data } = await askFn.stream({ instId, question });
    for await (const chunk of stream) if (chunk?.status) onStatus(chunk.status);
    return await data;
  } catch (e) {
    throw wrap(e);
  }
}
