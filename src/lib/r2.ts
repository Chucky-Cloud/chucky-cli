import { createReadStream, statSync } from "node:fs";
import type { UploadUrlInfo } from "./api.js";

/**
 * Upload a file to R2 using the presigned URL
 */
export async function uploadToR2(
  uploadInfo: UploadUrlInfo,
  filePath: string,
  onProgress?: (uploaded: number, total: number) => void
): Promise<void> {
  const { presignedUrl } = uploadInfo;

  // Get file stats
  const stats = statSync(filePath);
  const fileSize = stats.size;

  // Read file into buffer for upload
  const chunks: Buffer[] = [];
  const fileStream = createReadStream(filePath);

  let uploaded = 0;

  for await (const chunk of fileStream) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    chunks.push(buffer);
    uploaded += buffer.length;
    if (onProgress) {
      onProgress(uploaded, fileSize);
    }
  }

  const fileBuffer = Buffer.concat(chunks);

  // Upload using presigned URL
  const response = await fetch(presignedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": fileSize.toString(),
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upload failed: ${response.status} ${errorText}`);
  }
}
