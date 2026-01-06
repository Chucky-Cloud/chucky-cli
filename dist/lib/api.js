import { execSync } from "node:child_process";
import { getPortalUrl } from "./config.js";
/**
 * Execute HTTP request using curl as fallback
 */
function curlRequest(url, method, headers, body) {
    const headerArgs = Object.entries(headers)
        .map(([k, v]) => `-H "${k}: ${v}"`)
        .join(" ");
    const bodyArg = body ? `-d '${body.replace(/'/g, "'\\''")}'` : "";
    const cmd = `curl -s -X ${method} "${url}" ${headerArgs} ${bodyArg}`;
    return execSync(cmd, { encoding: "utf-8" });
}
/**
 * Retry a fetch request with exponential backoff, falling back to curl
 */
async function fetchWithRetry(url, options, maxRetries = 3) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fetch(url, options);
        }
        catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                // Exponential backoff: 1s, 2s, 4s
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
            }
        }
    }
    // Fall back to curl if all fetch attempts fail
    try {
        const headers = {};
        if (options.headers) {
            const h = options.headers;
            for (const [k, v] of Object.entries(h)) {
                headers[k] = v;
            }
        }
        const body = options.body;
        const result = curlRequest(url, options.method || "GET", headers, body);
        return new Response(result, { status: 200 });
    }
    catch {
        throw lastError;
    }
}
/**
 * API client for the Chucky portal
 */
export class ChuckyApi {
    baseUrl;
    apiKey;
    constructor(apiKey) {
        this.baseUrl = getPortalUrl();
        this.apiKey = apiKey;
    }
    async request(method, path, body) {
        const url = `${this.baseUrl}${path}`;
        const headers = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
        };
        const response = await fetchWithRetry(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || `Request failed: ${response.status}`);
        }
        return data;
    }
    /**
     * Validate API key
     */
    async validateApiKey() {
        const response = await fetchWithRetry(`${this.baseUrl}/api/validate-api-key`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ api_key: this.apiKey }),
        });
        return (await response.json());
    }
    /**
     * List all projects
     */
    async listProjects() {
        const result = await this.request("GET", "/api/projects");
        return result.projects;
    }
    /**
     * Create a new project
     */
    async createProject(name, options) {
        return this.request("POST", "/api/projects", {
            name,
            description: options?.description,
            anthropicApiKey: options?.anthropicApiKey,
        });
    }
    /**
     * Delete a project
     */
    async deleteProject(projectId) {
        await this.request("POST", "/api/projects/delete", {
            projectId,
        });
    }
    /**
     * Get HMAC key for a project
     */
    async getHmacKey(projectId) {
        return this.request("POST", "/api/projects/hmac-key", { projectId });
    }
    /**
     * Set Anthropic API key for a project
     */
    async setAnthropicKey(projectId, anthropicApiKey) {
        await this.request("POST", "/api/projects/anthropic-key", {
            projectId,
            anthropicApiKey,
        });
    }
    /**
     * Get upload URL for workspace
     */
    async getUploadUrl(projectId) {
        return this.request("POST", "/api/projects/upload-url", {
            projectId,
        });
    }
    /**
     * Mark workspace as uploaded
     */
    async markWorkspaceUploaded(projectId) {
        return this.request("POST", "/api/projects/workspace-uploaded", { projectId });
    }
}
//# sourceMappingURL=api.js.map