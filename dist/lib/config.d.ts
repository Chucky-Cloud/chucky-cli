export interface GlobalConfig {
    apiKey: string;
    email?: string;
    portalUrl: string;
}
export interface ProjectConfig {
    projectId: string;
    projectName: string;
    folder: string;
    hmacKey?: string;
}
/**
 * Load global config
 */
export declare function loadGlobalConfig(): GlobalConfig | null;
/**
 * Save global config
 */
export declare function saveGlobalConfig(config: GlobalConfig): void;
/**
 * Load project config from current directory
 */
export declare function loadProjectConfig(cwd?: string): ProjectConfig | null;
/**
 * Save project config to current directory
 */
export declare function saveProjectConfig(config: ProjectConfig, cwd?: string): void;
/**
 * Check if user is logged in
 */
export declare function isLoggedIn(): boolean;
/**
 * Get API key or throw if not logged in
 */
export declare function requireApiKey(): string;
/**
 * Get portal URL
 */
export declare function getPortalUrl(): string;
/**
 * Get project config or throw if not initialized
 */
export declare function requireProjectConfig(): ProjectConfig;
/**
 * Check if project is initialized in current directory
 */
export declare function isProjectInitialized(): boolean;
//# sourceMappingURL=config.d.ts.map