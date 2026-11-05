import { ref, uploadBytesResumable } from "firebase/storage";
import { storage } from "../../lib/firebase";

export const ACCEPT = ".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png";

export function mimeOf(f: File): string {
  if (f.type) return f.type;
  if (/\.pdf$/i.test(f.name)) return "application/pdf";
  if (/\.docx$/i.test(f.name)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (/\.png$/i.test(f.name)) return "image/png";
  if (/\.jpe?g$/i.test(f.name)) return "image/jpeg";
  return "application/octet-stream";
}

/** Resumable upload, so a dropped 3G connection carries on where it stopped. */
export function uploadFile(path: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage, path), file, { contentType: mimeOf(file) });
    task.on("state_changed", (s) => onProgress(Math.round((s.bytesTransferred / Math.max(1, s.totalBytes)) * 100)), reject, () => resolve());
  });
}
