// OCR with Google Cloud Document AI, Cloud Vision as fallback (PRD section 7).
// Both run in the same Google Cloud project; no keys leave the server.
import { GoogleAuth } from "google-auth-library";
import { logger } from "firebase-functions";
import { DOCAI_PROCESSOR } from "../lib/params";

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

export interface OcrResult {
  text: string;
  confidence: number | null;
  engine: "documentai" | "vision";
  language: string | null;
}

async function token(): Promise<string> {
  const client = await auth.getClient();
  const t = await client.getAccessToken();
  if (!t.token) throw new Error("No Google access token");
  return t.token;
}

async function documentAi(jpeg: Buffer): Promise<OcrResult> {
  const processor = DOCAI_PROCESSOR.value();
  if (!processor) throw new Error("Document AI processor not configured");
  const location = processor.split("/locations/")[1]?.split("/")[0] ?? "eu";
  const res = await fetch(`https://${location}-documentai.googleapis.com/v1/${processor}:process`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ rawDocument: { content: jpeg.toString("base64"), mimeType: "image/jpeg" }, skipHumanReview: true }),
  });
  if (!res.ok) throw new Error(`Document AI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const { document } = (await res.json()) as { document: { text?: string; pages?: { tokens?: { layout?: { confidence?: number } }[]; paragraphs?: { layout?: { confidence?: number } }[]; detectedLanguages?: { languageCode?: string }[] }[] } };
  const page = document.pages?.[0];
  const confs = (page?.tokens?.length ? page.tokens : page?.paragraphs ?? []).map((t) => t.layout?.confidence).filter((x): x is number => typeof x === "number");
  return {
    text: (document.text ?? "").replace(/\r/g, "").trim(),
    confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
    engine: "documentai",
    language: page?.detectedLanguages?.[0]?.languageCode ?? null,
  };
}

async function vision(jpeg: Buffer): Promise<OcrResult> {
  const res = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ image: { content: jpeg.toString("base64") }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }] }] }),
  });
  if (!res.ok) throw new Error(`Vision ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { responses: { fullTextAnnotation?: { text?: string; pages?: { confidence?: number; property?: { detectedLanguages?: { languageCode?: string }[] } }[] }; error?: { message: string } }[] };
  const r = json.responses[0];
  if (r.error) throw new Error(r.error.message);
  return { text: (r.fullTextAnnotation?.text ?? "").trim(), confidence: r.fullTextAnnotation?.pages?.[0]?.confidence ?? null, engine: "vision", language: r.fullTextAnnotation?.pages?.[0]?.property?.detectedLanguages?.[0]?.languageCode ?? null };
}

/** Pages below this confidence go to the digitisation queue for a person to check. */
export const LOW_CONFIDENCE = 0.85;

export async function ocrPage(jpeg: Buffer): Promise<OcrResult> {
  try {
    return await documentAi(jpeg);
  } catch (e) {
    logger.warn("Document AI failed, falling back to Vision", { err: (e as Error).message });
    return vision(jpeg);
  }
}
