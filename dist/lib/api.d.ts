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
export declare class ChuckyApi {
    private baseUrl;
    private apiKey;
    constructor(apiKey: string);
    private request;
    /**
     * Validate API key
     */
    validateApiKey(): Promise<ValidationResult>;
    /**
     * List all projects
     */
    listProjects(): Promise<Project[]>;
    /**
     * Create a new project
     */
    createProject(name: string, options?: {
        description?: string;
        anthropicApiKey?: string;
    }): Promise<CreateProjectResult>;
    /**
     * Delete a project
     */
    deleteProject(projectId: string): Promise<void>;
    /**
     * Get HMAC key for a project
     */
    getHmacKey(projectId: string): Promise<{
        hmacKey: string;
        createdAt: number;
    }>;
    /**
     * Set Anthropic API key for a project
     */
    setAnthropicKey(projectId: string, anthropicApiKey: string): Promise<void>;
    /**
     * Get upload URL for workspace
     */
    getUploadUrl(projectId: string): Promise<UploadUrlInfo>;
    /**
     * Mark workspace as uploaded
     */
    markWorkspaceUploaded(projectId: string): Promise<{
        success: boolean;
        hasWorkspace: boolean;
        projectUuid: string;
    }>;
}
//# sourceMappingURL=api.d.ts.map