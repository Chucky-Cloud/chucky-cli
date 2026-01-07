import crypto from "node:crypto";

/**
 * CLI user ID - hardcoded for developer CLI usage
 */
const CLI_USER_ID = "cli-user";

/**
 * CLI budget - effectively unlimited for developer usage
 */
const CLI_BUDGET = {
  ai: 100_000_000, // $100 in microdollars
  compute: 36_000_000, // 10,000 hours in seconds
  window: "hour" as const,
};

export interface TokenOptions {
  projectId: string;
  hmacSecret: string;
  expiresInSeconds?: number;
}

/**
 * Generate a JWT token for the prompt API
 */
export function generateToken(options: TokenOptions): string {
  const { projectId, hmacSecret, expiresInSeconds = 3600 } = options;

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: CLI_USER_ID,
    iss: projectId,
    exp: now + expiresInSeconds,
    iat: now,
    budget: {
      ...CLI_BUDGET,
      windowStart: new Date().toISOString().split("T")[0] + "T00:00:00Z",
    },
  };

  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", hmacSecret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");

  return `${headerB64}.${payloadB64}.${signature}`;
}
