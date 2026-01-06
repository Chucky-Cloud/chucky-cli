import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const CONFIG_DIR = join(homedir(), ".chucky");
const GLOBAL_CONFIG_PATH = join(CONFIG_DIR, "config.json");
const PROJECT_CONFIG_FILE = ".chucky.json";
// Default portal URL (production)
const DEFAULT_PORTAL_URL = "https://doting-hornet-490.convex.site";
/**
 * Ensure config directory exists
 */
function ensureConfigDir() {
    if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
    }
}
/**
 * Load global config
 */
export function loadGlobalConfig() {
    try {
        if (!existsSync(GLOBAL_CONFIG_PATH)) {
            return null;
        }
        const content = readFileSync(GLOBAL_CONFIG_PATH, "utf-8");
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
/**
 * Save global config
 */
export function saveGlobalConfig(config) {
    ensureConfigDir();
    writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2));
}
/**
 * Load project config from current directory
 */
export function loadProjectConfig(cwd = process.cwd()) {
    try {
        const configPath = join(cwd, PROJECT_CONFIG_FILE);
        if (!existsSync(configPath)) {
            return null;
        }
        const content = readFileSync(configPath, "utf-8");
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
/**
 * Save project config to current directory
 */
export function saveProjectConfig(config, cwd = process.cwd()) {
    const configPath = join(cwd, PROJECT_CONFIG_FILE);
    writeFileSync(configPath, JSON.stringify(config, null, 2));
}
/**
 * Check if user is logged in
 */
export function isLoggedIn() {
    const config = loadGlobalConfig();
    return config !== null && !!config.apiKey;
}
/**
 * Get API key or throw if not logged in
 */
export function requireApiKey() {
    // Check environment variable first
    const envKey = process.env.CHUCKY_API_KEY;
    if (envKey) {
        return envKey;
    }
    const config = loadGlobalConfig();
    if (!config?.apiKey) {
        throw new Error("Not logged in. Run 'chucky login' first or set CHUCKY_API_KEY environment variable.");
    }
    return config.apiKey;
}
/**
 * Get portal URL
 */
export function getPortalUrl() {
    const config = loadGlobalConfig();
    return config?.portalUrl || DEFAULT_PORTAL_URL;
}
/**
 * Get project config or throw if not initialized
 */
export function requireProjectConfig() {
    const config = loadProjectConfig();
    if (!config) {
        throw new Error("Project not initialized. Run 'chucky init' first.");
    }
    return config;
}
/**
 * Check if project is initialized in current directory
 */
export function isProjectInitialized() {
    return loadProjectConfig() !== null;
}
//# sourceMappingURL=config.js.map