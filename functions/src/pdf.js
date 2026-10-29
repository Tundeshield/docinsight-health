// Server-side PDF handling: per-page text extraction and page rendering for OCR.
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");

// pdf.js renders through this factory so it uses @napi-rs/canvas in Node.
class NapiCanvasFactory {
  create(width, height) { const canvas = createCanvas(Math.max(1, width), Math.max(1, height)); return { canvas, context: canvas.getContext("2d") }; }
  reset(cc, width, height) { cc.canvas.width = width; cc.canvas.height = height; }
  destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; cc.canvas = null; cc.context = null; }
}

/** Below this many characters a page is treated as a scanned image. */
export const MIN_TEXT_CHARS = 40;

export async function openPdf(buffer) {
  return getDocument({ data: new Uint8Array(buffer), canvasFactory: new NapiCanvasFactory(), isEvalSupported: false, useSystemFonts: true, verbosity: 0 }).promise;
}

/** Returns [{ n, text }] for every page; text is "" for pages that look scanned. */
export async function extractPages(pdf) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    let text = ""; let lastY = null;
    for (const it of tc.items) {
      const y = it.transform ? it.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) text += "\n";
      text += it.str; lastY = y;
    }
    text = text.replace(/\n{3,}/g, "\n\n").trim();
    pages.push({ n, text: text.length >= MIN_TEXT_CHARS ? text : "" });
    page.cleanup();
  }
  return pages;
}

/** Renders one page to a PNG buffer about 1800px wide, on a white background. */
export async function renderPage(pdf, n, targetWidth = 1800) {
  const page = await pdf.getPage(n);
  const v1 = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(3, targetWidth / v1.width) });
  const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvasFactory: new NapiCanvasFactory() }).promise;
  page.cleanup();
  return canvas.toBuffer("image/png");
}
