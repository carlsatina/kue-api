import multer from "multer";
import sharp from "sharp";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const PROOFS_DIR = join(__dirname, "../../uploads/proofs");
const MAX_BYTES = 200 * 1024;

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
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
    if (out.length <= MAX_BYTES) return out;
  }
  return sharp(base).jpeg({ quality: 10 }).toBuffer();
}
