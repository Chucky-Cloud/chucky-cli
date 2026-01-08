import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Global config stored in ~/.chucky/config.json
export interface GlobalConfig {
  apiKey: string;
  email?: string;
  portalUrl: string;
}

// Cron job definition in .chucky.json
export interface CronCallback {
  url: string;
  headers?: Record<string, string>;
  secret?: string;
}

export interface CronDefinition {
  // Cron-specific options (required)
  cron: string;
  message: string;

  // Cron-specific options (optional)
  timezone?: string;
  enabled?: boolean;
  callback?: CronCallback;

  // SDK options (all optional)
  model?: string;
  fallbackModel?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  maxThinkingTokens?: number;
  systemPrompt?: string | { type: "preset"; preset: string; append?: string };
  tools?: string[] | "claude_code";
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: unknown[];
  agents?: Record<string, unknown>;
  betas?: string[];
  permissionMode?: "default" | "plan" | "bypassPermissions";
  allowDangerouslySkipPermissions?: boolean;
  env?: Record<string, string>;
  outputFormat?: { type: "json_schema"; schema: object };
}

// Project config stored in chucky.json (committed, shareable as starter kit)
export interface ChuckyConfig {
  name: string;
  description?: string;
  folder?: string;
  crons?: CronDefinition[];
}

// Project binding stored in .chucky (gitignored, local only)
export interface ProjectBinding {
  projectId: string;
}

// Combined config for internal use
export interface ProjectConfig {
  // From chucky.json
  name: string;
  description?: string;
  folder: string;
  crons?: CronDefinition[];
  // From .chucky
  projectId?: string;
}

const CONFIG_DIR = join(homedir(), ".chucky");
const GLOBAL_CONFIG_PATH = join(CONFIG_DIR, "config.json");
const CHUCKY_CONFIG_FILE = "chucky.json";      // Committed
const PROJECT_BINDING_FILE = ".chucky";         // Gitignored

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
 * Load chucky.json config (committed file)
 */
export function loadChuckyConfig(cwd: string = process.cwd()): ChuckyConfig | null {
  try {
    const configPath = join(cwd, CHUCKY_CONFIG_FILE);
    if (!existsSync(configPath)) {
      return null;
    }
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content) as ChuckyConfig;
  } catch {
    return null;
  }
}

/**
 * Save chucky.json config (committed file)
 */
export function saveChuckyConfig(config: ChuckyConfig, cwd: string = process.cwd()): void {
  const configPath = join(cwd, CHUCKY_CONFIG_FILE);
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Load .chucky project binding (gitignored file)
 */
export function loadProjectBinding(cwd: string = process.cwd()): ProjectBinding | null {
  try {
    const bindingPath = join(cwd, PROJECT_BINDING_FILE);
    if (!existsSync(bindingPath)) {
      return null;
    }
    const content = readFileSync(bindingPath, "utf-8");
    return JSON.parse(content) as ProjectBinding;
  } catch {
    return null;
  }
}

/**
 * Save .chucky project binding (gitignored file)
 */
export function saveProjectBinding(binding: ProjectBinding, cwd: string = process.cwd()): void {
  const bindingPath = join(cwd, PROJECT_BINDING_FILE);
  writeFileSync(bindingPath, JSON.stringify(binding, null, 2));
}

/**
 * Load combined project config (chucky.json + .chucky)
 */
export function loadProjectConfig(cwd: string = process.cwd()): ProjectConfig | null {
  const chuckyConfig = loadChuckyConfig(cwd);
  if (!chuckyConfig) {
    return null;
  }

  const binding = loadProjectBinding(cwd);

  return {
    name: chuckyConfig.name,
    description: chuckyConfig.description,
    folder: chuckyConfig.folder || ".",
    crons: chuckyConfig.crons,
    projectId: binding?.projectId,
  };
}

/**
 * Legacy: Save project config (for backwards compatibility during migration)
 * @deprecated Use saveChuckyConfig and saveProjectBinding separately
 */
export function saveProjectConfig(config: ProjectConfig, cwd: string = process.cwd()): void {
  // Save chucky.json (committed)
  saveChuckyConfig({
    name: config.name,
    description: config.description,
    folder: config.folder,
    crons: config.crons,
  }, cwd);

  // Save .chucky (gitignored) if projectId exists
  if (config.projectId) {
    saveProjectBinding({ projectId: config.projectId }, cwd);
  }
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
    throw new Error("No chucky.json found. Run 'chucky init' first.");
  }
  return config;
}

/**
 * Check if chucky.json exists in current directory
 */
export function hasChuckyConfig(): boolean {
  return loadChuckyConfig() !== null;
}

/**
 * Check if project is bound (has .chucky with projectId)
 */
export function isProjectBound(): boolean {
  return loadProjectBinding() !== null;
}

/**
 * Check if project is initialized in current directory
 * @deprecated Use hasChuckyConfig() and isProjectBound() separately
 */
export function isProjectInitialized(): boolean {
  return hasChuckyConfig();
}
