// PDF text extraction per page and page rendering (Node: pdf.js + @napi-rs/canvas).
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");

class CanvasFactory {
  create(w: number, h: number) { const canvas = createCanvas(Math.max(1, w), Math.max(1, h)); return { canvas, context: canvas.getContext("2d") }; }
  reset(cc: { canvas: { width: number; height: number } }, w: number, h: number) { cc.canvas.width = w; cc.canvas.height = h; }
  destroy(cc: { canvas: { width: number; height: number } | null; context: unknown }) { if (cc.canvas) { cc.canvas.width = 0; cc.canvas.height = 0; } cc.canvas = null; cc.context = null; }
}

export const MIN_TEXT_CHARS = 40;

export async function openPdf(buf: Buffer): Promise<PDFDocumentProxy> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getDocument({ data: new Uint8Array(buf), canvasFactory: new CanvasFactory(), isEvalSupported: false, useSystemFonts: true, verbosity: 0 } as any).promise;
}

/** Text of one page, with line breaks where the baseline changes. "" when the page looks scanned. */
export async function pageText(pdf: PDFDocumentProxy, n: number): Promise<string> {
  const page = await pdf.getPage(n);
  const tc = await page.getTextContent();
  let text = "", lastY: number | null = null, lastX = 0;
  for (const it of tc.items as { str: string; transform: number[]; width: number }[]) {
    if (!("str" in it)) continue;
    const y = it.transform?.[5] ?? null, x = it.transform?.[4] ?? 0;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) text += "\n";
    else if (lastY !== null && x - lastX > 8 && !text.endsWith(" ") && !it.str.startsWith(" ")) text += " ";
    text += it.str;
    lastY = y; lastX = x + (it.width ?? 0);
  }
  page.cleanup();
  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.replace(/\s/g, "").length >= MIN_TEXT_CHARS ? text : "";
}

/** Renders a page to PNG at about `width` pixels wide on a white background. */
export async function renderPage(pdf: PDFDocumentProxy, n: number, width = 1400): Promise<Buffer> {
  const page = await pdf.getPage(n);
  const v1 = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(3, width / v1.width) });
  const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.render({ canvasContext: ctx as any, viewport, canvasFactory: new CanvasFactory() as any } as any).promise;
  page.cleanup();
  return canvas.toBuffer("image/png");
}
