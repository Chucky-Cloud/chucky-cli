# Chucky CLI

[![npm version](https://img.shields.io/npm/v/@chucky.cloud/cli.svg)](https://www.npmjs.com/package/@chucky.cloud/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

Command-line interface for deploying AI agent workspaces to the [Chucky](https://chucky.cloud) cloud platform. Build and ship Claude-powered assistants with ease.

## Installation

```bash
npm install -g @chucky.cloud/cli
```

## Quick Start

```bash
# Authenticate with your Chucky account
chucky login

# Initialize a new project
chucky init

# Deploy your workspace
chucky deploy
```

## Commands

### `chucky login`

Authenticate with your Chucky account using browser-based device flow or API key.

```bash
# Interactive browser-based login (recommended)
chucky login

# Direct API key authentication
chucky login -k ak_live_xxxxx
```

**Options:**
- `-k, --key <key>` - Skip browser flow and authenticate with API key directly

### `chucky list` / `chucky ls`

List all projects in your account.

```bash
chucky list
```

Displays project name, ID, status, and HMAC key for each project.

### `chucky init`

Initialize a new Chucky project in the current directory.

```bash
chucky init
```

**What it does:**
1. Creates or selects an existing project
2. Prompts for project name and description
3. Optionally configures Anthropic API key
4. Saves `.chucky.json` configuration file
5. Optionally sets up GitHub Actions workflow

### `chucky deploy`

Deploy your workspace to the Chucky cloud.

```bash
# Deploy using config from .chucky.json
chucky deploy

# Deploy a specific folder
chucky deploy -f ./my-workspace
```

**Options:**
- `-f, --folder <path>` - Override the folder to deploy

**Deployment flow:**
1. Creates tar.gz archive of workspace folder
2. Uploads to Chucky cloud storage (R2)
3. Marks workspace as deployed
4. Displays example code for generating tokens

### `chucky keys`

Display the HMAC key for the current project.

```bash
chucky keys
```

### `chucky config anthropic`

Set the Anthropic API key for a project.

```bash
# Interactive prompt
chucky config anthropic

# Direct key input
chucky config anthropic -k sk-ant-xxxxx
```

**Options:**
- `-k, --key <key>` - Anthropic API key to set

### `chucky delete`

Delete a project.

```bash
# Delete from selection list
chucky delete

# Delete specific project
chucky delete PROJECT_ID
```

## Configuration

### Global Config (`~/.chucky/config.json`)

Stores user credentials:
```json
{
  "apiKey": "ak_live_...",
  "email": "user@example.com",
  "portalUrl": "https://app.chucky.cloud"
}
```

### Project Config (`.chucky.json`)

Stores project-specific settings:
```json
{
  "projectId": "uuid-...",
  "projectName": "my-project",
  "folder": "./workspace",
  "hmacKey": "hk_live_..."
}
```

## Environment Variables

- `CHUCKY_API_KEY` - Override API key from config
- `CHUCKY_PORTAL_URL` - Override portal URL (for development)

## Authentication Flow

### Browser-Based (Device Code Flow)

1. CLI generates a device code and opens browser
2. User signs in to Chucky portal
3. User confirms the device code
4. CLI receives API key and stores locally

### API Key

1. User obtains API key from Chucky portal
2. User runs `chucky login -k ak_live_...`
3. CLI validates key and stores locally

## Workspace Deployment

### Default Ignore Patterns

The following are excluded from deployment archives:
- `node_modules/`
- `.git/`
- `.env` files
- `dist/`, `build/`
- Cache and log directories

### Archive Format

Workspaces are compressed as `.tgz` (tar.gz) with maximum compression.

## Dependencies

- **commander** - CLI framework
- **inquirer** - Interactive prompts
- **chalk** - Terminal styling
- **ora** - Progress spinners
- **archiver** - Archive creation

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch mode
npm run dev

# Type checking only
npm run typecheck
```

## License

MIT
