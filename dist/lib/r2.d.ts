import type { UploadUrlInfo } from "./api.js";
/**
 * Upload a file to R2 using the presigned URL
 */
export declare function uploadToR2(uploadInfo: UploadUrlInfo, filePath: string, onProgress?: (uploaded: number, total: number) => void): Promise<void>;
//# sourceMappingURL=r2.d.ts.map