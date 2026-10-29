// Prepares page images for Claude: orientation fixed, tall pages split into overlapping halves
// so small print survives the API's image downsizing.
import sharp from "sharp";

export async function pagePieces(input) {
  const img = sharp(input, { failOn: "none" }).rotate(); // apply EXIF orientation
  const { data, info } = await img.resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).png().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (width > height * 0.9) return { split: false, pieces: [await sharp(data).jpeg({ quality: 88 }).toBuffer()] };
  const parts = [[0, 0.55], [0.45, 1]];
  const pieces = await Promise.all(parts.map(([a, b]) => sharp(data).extract({ left: 0, top: Math.round(height * a), width, height: Math.round(height * (b - a)) - (b === 1 ? 0 : 0) }).jpeg({ quality: 88 }).toBuffer()));
  return { split: true, pieces };
}
