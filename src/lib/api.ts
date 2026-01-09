import { getPortalUrl, type CronDefinition } from "./config.js";

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
  projectId: string;
}

export interface ValidationResult {
  valid: boolean;
  customer_id?: string;
  clerkId?: string;
  email?: string;
  credit_balance_usd?: number;
  error?: string;
}

export interface CronJob {
  _id: string;
  projectId: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  message: string;
  triggerScheduleId?: string;
}

export interface SyncCronsResult {
  created: number;
  deleted: number;
  scheduleIds: string[];
}

export interface Job {
  id: string;
  status: string;
  taskIdentifier: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  isCompleted: boolean;
  isSuccess: boolean;
  isFailed: boolean;
  output?: unknown;
  error?: { message: string; name?: string };
}

export interface ListJobsResult {
  jobs: Job[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface Session {
  id: string;
  issuer_id: string;
  user_id: string;
  job_id: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  total_cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  has_bundle: boolean;
  bundle_has_changes: boolean;
}

export interface ListSessionsResult {
  sessions: Session[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface SessionBundleResult {
  session_id: string;
  download_url: string;
  has_changes: boolean;
  expires_in: number;
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
  ): Promise<{ success: boolean; hasWorkspace: boolean; projectId: string }> {
    return this.request<{ success: boolean; hasWorkspace: boolean; projectId: string }>(
      "POST",
      "/api/projects/workspace-uploaded",
      { projectId }
    );
  }

  /**
   * List cron jobs for a project
   */
  async listCronJobs(projectId: string): Promise<CronJob[]> {
    const result = await this.request<{ cronJobs: CronJob[] }>(
      "POST",
      "/api/crons/list",
      { projectId }
    );
    return result.cronJobs;
  }

  /**
   * Sync cron jobs for a project (delete all + recreate)
   */
  async syncCrons(
    projectId: string,
    crons: CronDefinition[]
  ): Promise<SyncCronsResult> {
    return this.request<SyncCronsResult>("POST", "/api/crons/sync", {
      projectId,
      crons,
    });
  }

  /**
   * List jobs (Trigger.dev runs)
   */
  async listJobs(options?: {
    status?: string;
    size?: number;
    cursor?: string;
  }): Promise<ListJobsResult> {
    return this.request<ListJobsResult>("POST", "/api/jobs/list", {
      status: options?.status,
      size: options?.size,
      cursor: options?.cursor,
    });
  }

  /**
   * Get a specific job
   */
  async getJob(jobId: string): Promise<{ job: Job }> {
    return this.request<{ job: Job }>("POST", "/api/jobs/get", { jobId });
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>("POST", "/api/jobs/cancel", { jobId });
  }

  /**
   * Get bundle download URL for a job
   */
  async getJobBundle(jobId: string): Promise<{ downloadUrl: string; hasChanges: boolean }> {
    return this.request<{ downloadUrl: string; hasChanges: boolean }>(
      "POST",
      "/api/jobs/bundle",
      { jobId }
    );
  }

  /**
   * List sessions
   */
  async listSessions(options?: {
    limit?: number;
    offset?: number;
    withBundle?: boolean;
    userId?: string;
    jobId?: string;
    projectId?: string;
  }): Promise<ListSessionsResult> {
    return this.request<ListSessionsResult>("POST", "/api/sessions/list", {
      limit: options?.limit,
      offset: options?.offset,
      with_bundle: options?.withBundle,
      user_id: options?.userId,
      job_id: options?.jobId,
      project_id: options?.projectId,
    });
  }

  /**
   * Get a specific session
   */
  async getSession(sessionId: string): Promise<Session> {
    return this.request<Session>("POST", "/api/sessions/get", {
      session_id: sessionId,
    });
  }

  /**
   * Get bundle download URL for a session
   */
  async getSessionBundle(sessionId: string): Promise<SessionBundleResult> {
    return this.request<SessionBundleResult>("POST", "/api/sessions/bundle", {
      session_id: sessionId,
    });
  }

  /**
   * Resolve a partial session ID to the full UUID
   * Supports prefix matching like git commit hashes
   */
  async resolveSessionId(partialId: string, projectId?: string): Promise<string> {
    // If it looks like a full UUID, return as-is
    if (partialId.length >= 36) {
      return partialId;
    }

    // Fetch recent sessions and find matching prefix
    const result = await this.listSessions({ limit: 100, projectId });
    const matches = result.sessions.filter(s => s.id.startsWith(partialId));

    if (matches.length === 0) {
      throw new Error(`No session found matching '${partialId}'`);
    }

    if (matches.length > 1) {
      throw new Error(`Ambiguous session ID '${partialId}' - matches ${matches.length} sessions. Use more characters.`);
    }

    return matches[0].id;
  }

}

/**
 * Detect if an ID is a job ID (prefixed with run_) or a session ID
 */
export function isJobId(id: string): boolean {
  return id.startsWith("run_");
}
