# CLAUDE.md - Chucky CLI

This file provides guidance to Claude Code when working with the chucky-cli package.

## Package Overview

Command-line tool for deploying workspaces to the Chucky cloud platform. Built with Commander.js for CLI parsing, Inquirer for prompts, and supports browser-based device code authentication.

## Directory Structure

```
chucky-cli/
├── src/
│   ├── index.ts              # CLI entry point, command registration
│   ├── commands/             # Command implementations
│   │   ├── login.ts          # Device code flow + API key auth
│   │   ├── list.ts           # List all projects
│   │   ├── init.ts           # Initialize project in directory
│   │   ├── deploy.ts         # Deploy workspace to cloud
│   │   ├── keys.ts           # Show HMAC key
│   │   ├── config.ts         # Set Anthropic API key
│   │   └── delete.ts         # Delete a project
│   └── lib/                  # Core utilities
│       ├── config.ts         # Config file management (~/.chucky/, .chucky.json)
│       ├── api.ts            # ChuckyApi class - portal API client
│       ├── archive.ts        # Workspace tar.gz creation
│       └── r2.ts             # R2 upload via presigned URL
└── dist/                     # Compiled JavaScript output
```

## Build Commands

```bash
npm run build      # Compile TypeScript (tsc)
npm run dev        # Watch mode (tsc --watch)
npm run typecheck  # Type check only
```

## Key Patterns

### Configuration Management

Two-level configuration:
1. **Global** (`~/.chucky/config.json`): `apiKey`, `email`, `portalUrl`
2. **Project** (`.chucky.json`): `projectId`, `projectName`, `folder`, `hmacKey`

```typescript
// Load/save config
import { loadGlobalConfig, saveGlobalConfig, loadProjectConfig, saveProjectConfig } from './lib/config'

// Require authentication
const apiKey = requireApiKey() // throws if not logged in

// Require project initialization
const projectConfig = requireProjectConfig() // throws if no .chucky.json
```

### API Client

```typescript
import { ChuckyApi } from './lib/api'

const api = new ChuckyApi(apiKey)

// Available methods:
api.validateApiKey()
api.listProjects()
api.createProject(name, { description, anthropicApiKey })
api.deleteProject(projectId)
api.getHmacKey(projectId)
api.setAnthropicKey(projectId, key)
api.getUploadUrl(projectId)
api.markWorkspaceUploaded(projectId)
```

### Device Code Authentication

```typescript
// Create device code
const { code, codeId, expiresAt, verificationUrl } = await createDeviceCode()

// Poll for authorization
const { apiKey, email } = await pollForToken(code)
```

### Workspace Deployment

```typescript
import { createArchive } from './lib/archive'
import { uploadToR2 } from './lib/r2'

// Create archive
const { archivePath, fileCount, size } = await createArchive(sourceDir, ignorePatterns)

// Get presigned URL
const { uploadUrl, s3Key, projectUuid } = await api.getUploadUrl(projectId)

// Upload
await uploadToR2(archivePath, uploadUrl, (progress) => console.log(progress))

// Finalize
await api.markWorkspaceUploaded(projectId)
```

## Authentication Tokens

### API Key Format
- Account API Key: `ak_live_...` (authenticates user)
- HMAC Key: `hk_live_...` (project-specific, used for JWT signing)
- Anthropic API Key: `sk-ant-...` (Claude API access)

### JWT Token Generation (shown in deploy output)

```typescript
// Tokens signed with HMAC key for end-user authentication
{
  sub: userId,       // End-user identifier
  iss: projectUuid,  // Project ID (extracted from HMAC key)
  exp: timestamp,    // Expiration
  iat: timestamp,    // Issued at
  budget: {
    ai: 1000000,     // $1 USD in microdollars
    compute: 3600000,// 1000 hours in seconds
    window: 'hour'
  }
}
```

## Error Handling

- Use `spinner.fail()` for visual error feedback
- Exit with code 1 on critical errors
- Clean up temp files on deployment failure
- Validate key formats before API calls

## Common Modifications

### Adding a New Command

1. Create `src/commands/newcommand.ts`:
```typescript
import { Command } from 'commander'
import { requireApiKey } from '../lib/config'
import { ChuckyApi } from '../lib/api'
import ora from 'ora'

export function createNewCommand(): Command {
  return new Command('newcommand')
    .description('Description of the command')
    .option('-o, --option <value>', 'Option description')
    .action(async (options) => {
      const spinner = ora('Loading...').start()
      try {
        const apiKey = requireApiKey()
        const api = new ChuckyApi(apiKey)
        // Implementation
        spinner.succeed('Done')
      } catch (error) {
        spinner.fail(error.message)
        process.exit(1)
      }
    })
}
```

2. Register in `src/index.ts`:
```typescript
import { createNewCommand } from './commands/newcommand'
program.addCommand(createNewCommand())
```

### Adding API Endpoints

Add to `src/lib/api.ts`:
```typescript
async newEndpoint(param: string): Promise<ResponseType> {
  const response = await fetch(`${this.baseUrl}/api/new-endpoint`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ param })
  })
  if (!response.ok) {
    throw new Error(await this.parseError(response))
  }
  return response.json()
}
```

## Dependencies

| Package | Purpose |
|---------|---------|
| commander | CLI command parsing and help generation |
| inquirer | Interactive prompts (select, confirm, input) |
| chalk | Terminal color styling |
| ora | Spinner progress indicators |
| archiver | Create tar.gz archives |

## Testing Locally

```bash
# Build and link globally
npm run build
npm link

# Run commands
chucky login
chucky init
chucky deploy

# Unlink when done
npm unlink -g @chucky.cloud/cli
```
