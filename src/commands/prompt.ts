import chalk from "chalk";
import ora from "ora";
import { select } from "@inquirer/prompts";
import { requireApiKey, loadProjectConfig } from "../lib/config.js";
import { ChuckyApi, Project } from "../lib/api.js";
import {
  ChuckyClient,
  createToken,
  createBudget,
  browserTool,
  createMcpServer,
  getAssistantText,
  isSuccessResult,
  type ToolDefinition,
  type SessionOptions,
  type SDKMessage,
} from "@chucky.cloud/sdk";
import {
  executeHostBash,
  executeHostRead,
  executeHostWrite,
  executeHostEdit,
  executeHostGlob,
  executeHostGrep,
} from "../lib/host-tools.js";

export interface PromptOptions {
  project?: string;
  token?: string;
  outputFormat?: "text" | "json" | "stream-json";
  jsonSchema?: string;
  model?: string;
  systemPrompt?: string;
  tools?: string;
  allowedTools?: string;
  disallowedTools?: string;
  permissionMode?: string;
  dangerouslySkipPermissions?: boolean;
  maxTurns?: number;
  maxBudgetUsd?: number;
  mcpConfig?: string;
  agents?: string;
  betas?: string;
  allowPossession?: boolean;
}

/**
 * Main prompt command handler
 */
export async function promptCommand(
  promptText: string | undefined,
  options: PromptOptions
): Promise<void> {
  // Read prompt from stdin if not provided
  let message = promptText;
  if (!message) {
    if (!process.stdin.isTTY) {
      message = await readStdin();
    }
    if (!message) {
      console.log(chalk.red("Error: No prompt provided"));
      console.log(chalk.dim("Usage: chucky prompt 'your prompt here'"));
      console.log(chalk.dim("   or: echo 'prompt' | chucky prompt --project myproject"));
      process.exit(1);
    }
  }

  try {
    // Get or use provided token
    let token = options.token;
    let projectName = "custom-token";

    if (!token) {
      const { project, hmacKey } = await resolveProject(options.project);
      projectName = project.name;
      token = await createToken({
        userId: "cli-user",
        projectId: project.id,
        secret: hmacKey,
        budget: createBudget({
          aiDollars: 100,
          computeHours: 10000,
          window: "hour",
        }),
      });
    }

    // Build session options
    const sessionOptions = buildSessionOptions(options);

    // Add host tools if --allow-possession is set
    if (options.allowPossession) {
      const hostTools = getHostTools(options);
      const hostServer = createMcpServer("host-tools", hostTools);
      sessionOptions.mcpServers = [...(sessionOptions.mcpServers || []), hostServer];

      // Set default system prompt with possession context if not already set
      if (!sessionOptions.systemPrompt) {
        sessionOptions.systemPrompt = {
          type: "preset",
          preset: "claude_code",
          append: `
## Host Machine Access (Possession Mode)

You are running inside a sandboxed environment, but you have access to the USER'S LOCAL MACHINE through special "Host" tools provided via the \`host-tools\` MCP server.

### Understanding the Two Environments:

1. **Sandbox (where you run)**: Your default tools (Write, Bash, Read, Edit, Glob, Grep) operate HERE in an isolated container. Files you create with \`Write\` or commands you run with \`Bash\` happen in the sandbox.

2. **Host Machine (user's computer)**: The Host tools (HostBash, HostRead, HostWrite, HostEdit, HostGlob, HostGrep) operate on the USER'S ACTUAL MACHINE. Use these when the user wants something done on their local filesystem.

### Host Tools Available:
- **HostBash**: Execute shell commands on the user's machine
- **HostRead**: Read files from the user's filesystem
- **HostWrite**: Write files to the user's filesystem
- **HostEdit**: Edit files on the user's filesystem (find/replace)
- **HostGlob**: Find files matching patterns on the user's filesystem
- **HostGrep**: Search file contents on the user's filesystem

### When to Use Host Tools:
- User asks to modify files "on my machine" or "locally"
- User wants to run commands on their system
- User wants to read/write to their actual project directory
- Any operation that should persist on the user's computer

### Important:
- Host tools have the \`mcp__host-tools__\` prefix (e.g., \`mcp__host-tools__HostBash\`)
- Be careful with Host tools - they affect the user's real filesystem
- The working directory for Host tools is: ${process.cwd()}
`,
        };
      }

      console.log(
        chalk.yellow(`\n⚠️  Possession mode enabled - Claude can execute commands on your machine`)
      );
      console.log(chalk.dim(`   Host tools: ${hostTools.map((t) => t.name).join(", ")}\n`));
    }

    const outputFormat = options.outputFormat || "text";
    const jsonOutput = outputFormat === "json" || outputFormat === "stream-json";

    const spinner = ora(`Connecting to ${chalk.cyan(projectName)}...`).start();

    // Create client and session
    const client = new ChuckyClient({ token });
    const session = await client.createSession(sessionOptions);

    spinner.text = `Sending prompt to ${chalk.cyan(projectName)}...`;

    // Send the message
    await session.send(message);
    spinner.stop();

    // Stream the response
    let finalResult: SDKMessage | null = null;

    for await (const msg of session.stream()) {
      if (jsonOutput) {
        console.log(JSON.stringify(msg));
      } else {
        if (msg.type === "assistant") {
          // Use SDK helper to extract text
          const text = getAssistantText(msg);
          if (text) {
            process.stdout.write(text);
          }
          // Also check for tool uses in the content
          const content = msg.message?.content || [];
          for (const block of content) {
            if (typeof block === "object" && block.type === "tool_use") {
              console.log(chalk.blue(`\n[Tool] ${block.name}`));
            }
          }
        } else if (msg.type === "user") {
          // Tool results come back as user messages
          const content = msg.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (typeof block === "object" && block.type === "tool_result") {
                const resultContent = typeof block.content === "string"
                  ? block.content
                  : JSON.stringify(block.content);
                const preview = resultContent.length > 200
                  ? resultContent.slice(0, 200) + "..."
                  : resultContent;
                console.log(chalk.green(`[Result] ${preview}`));
              }
            }
          }
        } else if (msg.type === "result") {
          finalResult = msg;
        }
      }
    }

    if (!jsonOutput) {
      console.log(chalk.green("\n\n✓ Complete"));
    } else if (outputFormat === "json" && finalResult && isSuccessResult(finalResult)) {
      // For pure JSON mode, also output the final result
      const output = finalResult.structured_output ?? finalResult.result;
      if (options.jsonSchema && output) {
        console.log(JSON.stringify({ finalResult: output }, null, 2));
      }
    }

    // Close the session
    session.close();
  } catch (error) {
    console.log(chalk.red(`\nError: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * Read prompt from stdin
 */
async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data.trim());
    });
    setTimeout(() => {
      if (!data) resolve("");
    }, 100);
  });
}

/**
 * Resolve project by name, ID, or interactive selection
 */
async function resolveProject(
  projectNameOrId?: string
): Promise<{ project: Project; hmacKey: string }> {
  const apiKey = requireApiKey();
  const api = new ChuckyApi(apiKey);

  if (!projectNameOrId) {
    const localConfig = loadProjectConfig();
    if (localConfig) {
      projectNameOrId = localConfig.projectId;
    }
  }

  const projects = await api.listProjects();
  if (projects.length === 0) {
    throw new Error("No projects found. Create one with 'chucky init' first.");
  }

  let project: Project | undefined;

  if (projectNameOrId) {
    project = projects.find(
      (p) =>
        p.id === projectNameOrId ||
        p.name.toLowerCase() === projectNameOrId.toLowerCase()
    );
    if (!project) {
      throw new Error(`Project not found: ${projectNameOrId}`);
    }
  } else {
    const choices = projects.map((p) => ({
      name: `${p.name} ${p.isActive ? chalk.green("(active)") : chalk.dim("(inactive)")}`,
      value: p.id,
    }));

    const selectedId = await select({
      message: "Select a project:",
      choices,
    });

    project = projects.find((p) => p.id === selectedId)!;
  }

  const hmacInfo = await api.getHmacKey(project.id);
  return { project, hmacKey: hmacInfo.hmacKey };
}

/**
 * Build session options from CLI options
 */
function buildSessionOptions(options: PromptOptions): SessionOptions {
  const sessionOptions: SessionOptions = {};

  if (options.model) {
    const modelMap: Record<string, string> = {
      sonnet: "claude-sonnet-4-5-20250929",
      opus: "claude-opus-4-5-20250929",
      haiku: "claude-haiku-3-5-20250929",
    };
    sessionOptions.model = (modelMap[options.model] || options.model) as SessionOptions["model"];
  }

  if (options.systemPrompt) {
    // Try to parse as JSON for preset format
    try {
      const parsed = JSON.parse(options.systemPrompt);
      if (parsed.type === "preset") {
        sessionOptions.systemPrompt = parsed;
      } else {
        sessionOptions.systemPrompt = options.systemPrompt;
      }
    } catch {
      // Not JSON, use as string
      sessionOptions.systemPrompt = options.systemPrompt;
    }
  }

  if (options.tools) {
    // Try to parse as JSON for preset format
    try {
      const parsed = JSON.parse(options.tools);
      if (parsed.type === "preset") {
        // Preset format: { type: 'preset', preset: 'claude_code' }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sessionOptions.tools = parsed as any;
      } else if (Array.isArray(parsed)) {
        // Array of tool names
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sessionOptions.tools = parsed as any;
      } else {
        // Comma-separated string
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sessionOptions.tools = options.tools.split(",").map((t) => t.trim()) as any;
      }
    } catch {
      // Not JSON, treat as comma-separated list
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessionOptions.tools = options.tools.split(",").map((t) => t.trim()) as any;
    }
  }

  if (options.allowedTools) {
    sessionOptions.allowedTools = options.allowedTools.split(",").map((t) => t.trim());
  }

  if (options.disallowedTools) {
    sessionOptions.disallowedTools = options.disallowedTools.split(",").map((t) => t.trim());
  }

  if (options.permissionMode) {
    sessionOptions.permissionMode = options.permissionMode as SessionOptions["permissionMode"];
  }

  if (options.dangerouslySkipPermissions) {
    sessionOptions.permissionMode = "bypassPermissions";
    sessionOptions.allowDangerouslySkipPermissions = true;
  }

  if (options.maxTurns) {
    sessionOptions.maxTurns = options.maxTurns;
  }

  if (options.jsonSchema) {
    try {
      const schema = JSON.parse(options.jsonSchema);
      sessionOptions.outputFormat = {
        type: "json_schema",
        schema,
      };
    } catch {
      throw new Error("Invalid JSON in --json-schema");
    }
  }

  return sessionOptions;
}

/**
 * Get host tools based on allowed/disallowed lists
 */
function getHostTools(options: PromptOptions): ToolDefinition[] {
  const baseCwd = process.cwd();

  const allHostTools: ToolDefinition[] = [
    browserTool({
      name: "HostBash",
      description: "Execute a bash command on the user's local machine",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "The bash command to execute" },
          cwd: { type: "string", description: "Working directory (optional)" },
          timeout: { type: "number", description: "Timeout in ms (optional, default 30000)" },
        },
        required: ["command"],
      },
      handler: async (input) => executeHostBash(input as { command: string; cwd?: string; timeout?: number }, baseCwd),
    }),
    browserTool({
      name: "HostRead",
      description: "Read a file from the user's local filesystem",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file" },
          encoding: { type: "string", description: "File encoding (optional, default utf-8)" },
        },
        required: ["path"],
      },
      handler: async (input) => {
        const { path, encoding } = input as { path: string; encoding?: string };
        return executeHostRead({ path, encoding: encoding as BufferEncoding | undefined }, baseCwd);
      },
    }),
    browserTool({
      name: "HostWrite",
      description: "Write content to a file on the user's local filesystem",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file" },
          content: { type: "string", description: "Content to write" },
          encoding: { type: "string", description: "File encoding (optional, default utf-8)" },
        },
        required: ["path", "content"],
      },
      handler: async (input) => {
        const { path, content, encoding } = input as { path: string; content: string; encoding?: string };
        return executeHostWrite({ path, content, encoding: encoding as BufferEncoding | undefined }, baseCwd);
      },
    }),
    browserTool({
      name: "HostEdit",
      description: "Edit a file by replacing a specific string with another",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file" },
          old_string: { type: "string", description: "String to find" },
          new_string: { type: "string", description: "String to replace with" },
          replace_all: { type: "boolean", description: "Replace all occurrences (optional)" },
        },
        required: ["path", "old_string", "new_string"],
      },
      handler: async (input) => executeHostEdit(input as { path: string; old_string: string; new_string: string; replace_all?: boolean }, baseCwd),
    }),
    browserTool({
      name: "HostGlob",
      description: "Find files matching a glob pattern on the user's local filesystem",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: 'Glob pattern (e.g., "**/*.ts")' },
          cwd: { type: "string", description: "Base directory (optional)" },
          ignore: { type: "array", items: { type: "string" }, description: "Patterns to ignore" },
        },
        required: ["pattern"],
      },
      handler: async (input) => executeHostGlob(input as { pattern: string; cwd?: string; ignore?: string[] }, baseCwd),
    }),
    browserTool({
      name: "HostGrep",
      description: "Search for a pattern in files on the user's local filesystem",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for" },
          path: { type: "string", description: "Path to search in (optional)" },
          glob: { type: "string", description: "File pattern filter (optional)" },
          ignoreCase: { type: "boolean", description: "Case-insensitive (optional)" },
          maxResults: { type: "number", description: "Max results (optional, default 100)" },
        },
        required: ["pattern"],
      },
      handler: async (input) => executeHostGrep(input as { pattern: string; path?: string; glob?: string; ignoreCase?: boolean; maxResults?: number }, baseCwd),
    }),
  ];

  // Filter based on allowed/disallowed
  let tools = allHostTools;

  if (options.allowedTools) {
    const allowed = options.allowedTools.split(",").map((t) => t.trim());
    tools = tools.filter((t) => allowed.includes(t.name));
  }

  if (options.disallowedTools) {
    const disallowed = options.disallowedTools.split(",").map((t) => t.trim());
    tools = tools.filter((t) => !disallowed.includes(t.name));
  }

  return tools;
}
