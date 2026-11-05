import sharp from "sharp";

/** Page image for the viewer: ~1200px wide JPEG, small enough for 3G. */
export async function viewerImage(input: Buffer): Promise<{ full: Buffer; thumb: Buffer; width: number; height: number }> {
  const base = sharp(input, { failOn: "none" }).rotate().flatten({ background: "#ffffff" });
  const full = await base.clone().resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  const thumb = await base.clone().resize({ width: 320 }).jpeg({ quality: 60, mozjpeg: true }).toBuffer();
  return { full: full.data, thumb, width: full.info.width, height: full.info.height };
}

/** OCR input: up to 2400px on the long side, high quality JPEG. */
export async function ocrImage(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: "none" }).rotate().flatten({ background: "#ffffff" }).resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
}
