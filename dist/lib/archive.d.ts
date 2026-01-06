export interface ArchiveResult {
    path: string;
    size: number;
    fileCount: number;
}
/**
 * Create a tar.gz archive of a directory
 */
export declare function createArchive(sourceDir: string, ignorePatterns?: string[]): Promise<ArchiveResult>;
/**
 * Format bytes to human-readable string
 */
export declare function formatBytes(bytes: number): string;
/**
 * Get readable stream for archive
 */
export declare function getArchiveStream(archivePath: string): import("fs").ReadStream;
//# sourceMappingURL=archive.d.ts.map