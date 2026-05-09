import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { mkdir, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DRIVER = (process.env.STORAGE_DRIVER || "local").toLowerCase();
export const PROOFS_DIR = join(__dirname, "../../uploads/proofs");

let _s3 = null;
function getS3() {
  if (!_s3) {
    const accountId = process.env.R2_ACCOUNT_ID;
    if (!accountId) throw new Error("R2_ACCOUNT_ID is not set");
    _s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return _s3;
}

/**
 * Save a proof image buffer and return the URL to store in the database.
 * Driver is controlled by STORAGE_DRIVER env var: "local" (default) or "r2".
 */
export async function saveProof(buffer, filename) {
  if (DRIVER === "r2") {
    const bucket = process.env.R2_BUCKET;
    if (!bucket) throw new Error("R2_BUCKET is not set");
    const key = `proofs/${filename}`;
    await getS3().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: "image/jpeg",
      })
    );
    const base = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");
    if (!base) throw new Error("R2_PUBLIC_URL is not set");
    return `${base}/${key}`;
  }

  // local — ensure directory exists then write
  await mkdir(PROOFS_DIR, { recursive: true });
  await writeFile(join(PROOFS_DIR, filename), buffer);
  return `/uploads/proofs/${filename}`;
}
