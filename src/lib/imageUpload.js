import multer from "multer";
import sharp from "sharp";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB hard ceiling
const TARGET_BYTES = 200 * 1024;           // always compress output to ≤ 200 KB

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  }
});

export async function compressToTarget(buffer) {
  const base = await sharp(buffer)
    .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
    .toBuffer();

  for (let quality = 80; quality >= 20; quality -= 10) {
    const out = await sharp(base).jpeg({ quality }).toBuffer();
    if (out.length <= TARGET_BYTES) return out;
  }
  return sharp(base).jpeg({ quality: 10 }).toBuffer();
}
