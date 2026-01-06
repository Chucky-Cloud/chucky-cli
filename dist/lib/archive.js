import { createWriteStream, createReadStream, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import archiver from "archiver";
// Default patterns to ignore when creating archive
const DEFAULT_IGNORE_PATTERNS = [
    "node_modules/**",
    ".git/**",
    ".env",
    ".env.*",
    "*.log",
    ".DS_Store",
    "Thumbs.db",
    ".chucky.json",
    "dist/**",
    "build/**",
    ".next/**",
    ".nuxt/**",
    "coverage/**",
    ".cache/**",
    "*.tgz",
    "*.tar.gz",
];
/**
 * Create a tar.gz archive of a directory
 */
export async function createArchive(sourceDir, ignorePatterns = DEFAULT_IGNORE_PATTERNS) {
    const archiveName = `workspace-${Date.now()}.tgz`;
    const archivePath = join(tmpdir(), archiveName);
    return new Promise((resolve, reject) => {
        const output = createWriteStream(archivePath);
        const archive = archiver("tar", {
            gzip: true,
            gzipOptions: { level: 9 },
        });
        let fileCount = 0;
        output.on("close", () => {
            const stats = statSync(archivePath);
            resolve({
                path: archivePath,
                size: stats.size,
                fileCount,
            });
        });
        archive.on("entry", () => {
            fileCount++;
        });
        archive.on("error", (err) => {
            reject(err);
        });
        archive.pipe(output);
        // Add directory contents, respecting ignore patterns
        archive.glob("**/*", {
            cwd: sourceDir,
            ignore: ignorePatterns,
            dot: true, // Include dotfiles
        });
        archive.finalize();
    });
}
/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes) {
    if (bytes === 0)
        return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
/**
 * Get readable stream for archive
 */
export function getArchiveStream(archivePath) {
    return createReadStream(archivePath);
}
//# sourceMappingURL=archive.js.map