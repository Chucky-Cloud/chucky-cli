import { getPortalUrl } from "./config.js";

export interface Project {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  hmacKey: string;
  createdAt: number;
}

export interface CreateProjectResult {
  projectId: string;
  hmacKey: string;
}

export interface UploadUrlInfo {
  presignedUrl: string;
  key: string;
  projectUuid: string;
}

export interface ValidationResult {
  valid: boolean;
  customer_id?: string;
  email?: string;
  credit_balance_usd?: number;
  error?: string;
}

/**
 * API client for the Chucky portal
 */
export class ChuckyApi {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string) {
    this.baseUrl = getPortalUrl();
    this.apiKey = apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Request failed: ${response.status}`);
    }

    return data as T;
  }

  /**
   * Validate API key
   */
  async validateApiKey(): Promise<ValidationResult> {
    const response = await fetch(`${this.baseUrl}/api/validate-api-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: this.apiKey }),
    });

    return (await response.json()) as ValidationResult;
  }

  /**
   * List all projects
   */
  async listProjects(): Promise<Project[]> {
    const result = await this.request<{ projects: Project[] }>("GET", "/api/projects");
    return result.projects;
  }

  /**
   * Create a new project
   */
  async createProject(
    name: string,
    options?: { description?: string; anthropicApiKey?: string }
  ): Promise<CreateProjectResult> {
    return this.request<CreateProjectResult>("POST", "/api/projects", {
      name,
      description: options?.description,
      anthropicApiKey: options?.anthropicApiKey,
    });
  }

  /**
   * Delete a project
   */
  async deleteProject(projectId: string): Promise<void> {
    await this.request<{ success: boolean }>("POST", "/api/projects/delete", {
      projectId,
    });
  }

  /**
   * Get HMAC key for a project
   */
  async getHmacKey(projectId: string): Promise<{ hmacKey: string; createdAt: number }> {
    return this.request<{ hmacKey: string; createdAt: number }>(
      "POST",
      "/api/projects/hmac-key",
      { projectId }
    );
  }

  /**
   * Set Anthropic API key for a project
   */
  async setAnthropicKey(projectId: string, anthropicApiKey: string): Promise<void> {
    await this.request<{ success: boolean }>("POST", "/api/projects/anthropic-key", {
      projectId,
      anthropicApiKey,
    });
  }

  /**
   * Get upload URL for workspace
   */
  async getUploadUrl(projectId: string): Promise<UploadUrlInfo> {
    return this.request<UploadUrlInfo>("POST", "/api/projects/upload-url", {
      projectId,
    });
  }

  /**
   * Mark workspace as uploaded
   */
  async markWorkspaceUploaded(
    projectId: string
  ): Promise<{ success: boolean; hasWorkspace: boolean; projectUuid: string }> {
    return this.request<{ success: boolean; hasWorkspace: boolean; projectUuid: string }>(
      "POST",
      "/api/projects/workspace-uploaded",
      { projectId }
    );
  }
}
