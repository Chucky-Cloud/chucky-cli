import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Global config stored in ~/.chucky/config.json
export interface GlobalConfig {
  apiKey: string;
  email?: string;
  portalUrl: string;
}

// Project config stored in .chucky.json
export interface ProjectConfig {
  projectId: string;
  projectName: string;
  folder: string;
  hmacKey?: string;
}

const CONFIG_DIR = join(homedir(), ".chucky");
const GLOBAL_CONFIG_PATH = join(CONFIG_DIR, "config.json");
const PROJECT_CONFIG_FILE = ".chucky.json";

// Default portal URL (production)
const DEFAULT_PORTAL_URL = "https://doting-hornet-490.convex.site";

/**
 * Ensure config directory exists
 */
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Load global config
 */
export function loadGlobalConfig(): GlobalConfig | null {
  try {
    if (!existsSync(GLOBAL_CONFIG_PATH)) {
      return null;
    }
    const content = readFileSync(GLOBAL_CONFIG_PATH, "utf-8");
    return JSON.parse(content) as GlobalConfig;
  } catch {
    return null;
  }
}

/**
 * Save global config
 */
export function saveGlobalConfig(config: GlobalConfig): void {
  ensureConfigDir();
  writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * Load project config from current directory
 */
export function loadProjectConfig(cwd: string = process.cwd()): ProjectConfig | null {
  try {
    const configPath = join(cwd, PROJECT_CONFIG_FILE);
    if (!existsSync(configPath)) {
      return null;
    }
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content) as ProjectConfig;
  } catch {
    return null;
  }
}

/**
 * Save project config to current directory
 */
export function saveProjectConfig(config: ProjectConfig, cwd: string = process.cwd()): void {
  const configPath = join(cwd, PROJECT_CONFIG_FILE);
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Check if user is logged in
 */
export function isLoggedIn(): boolean {
  const config = loadGlobalConfig();
  return config !== null && !!config.apiKey;
}

/**
 * Get API key or throw if not logged in
 */
export function requireApiKey(): string {
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
export function getPortalUrl(): string {
  const config = loadGlobalConfig();
  return config?.portalUrl || DEFAULT_PORTAL_URL;
}

/**
 * Get project config or throw if not initialized
 */
export function requireProjectConfig(): ProjectConfig {
  const config = loadProjectConfig();
  if (!config) {
    throw new Error("Project not initialized. Run 'chucky init' first.");
  }
  return config;
}

/**
 * Check if project is initialized in current directory
 */
export function isProjectInitialized(): boolean {
  return loadProjectConfig() !== null;
}
