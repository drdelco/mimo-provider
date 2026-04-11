# MiMo by Xiaomi — Antigravity / VS Code Extension

Use **Xiaomi MiMo** language models as a full coding agent inside Google Antigravity and VS Code.

## Models

| Model | ID | Context | Best for |
|-------|-----|---------|----------|
| **MiMo V2 Pro** | `mimo-v2-pro` | 262K tokens | Advanced reasoning, complex coding tasks |
| **MiMo V2 Flash** | `mimo-v2-flash` | 262K tokens | Fast responses, quick edits |

## Features

### Chat Panel

Sidebar panel with its own chat interface — click the **M** icon in the Activity Bar.

- Conversation history with context awareness
- Quick action buttons: Explain, Refactor, Debug, Test
- Markdown rendering with syntax-highlighted code blocks
- One-click "Insert into editor" for generated code
- Attach files as context with the clip button
- Token usage tracking with link to MiMo Platform quota
- Stop button to abort running tasks instantly
- Send messages while MiMo works — they get injected into the next tool step

### Coding Agent (Tool Calling)

MiMo can autonomously use 7 tools to explore, edit, and test your code:

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Create new files or complete rewrites |
| `edit_file` | Surgical edits to specific parts of a file |
| `run_terminal` | Execute shell commands (builds, tests, git, npm) |
| `search_files` | Grep-like search across the codebase |
| `list_files` | List directory contents |
| `get_diagnostics` | Read errors/warnings from the VS Code Problems panel |

### Smart Context

- Auto-detects OS and injects shell commands (Windows CMD/PowerShell or Unix bash)
- Auto-loads project context files at each request: `CLAUDE.md`, `.claude/rules/`, `.cursorrules`, `AGENTS.md`, `.github/copilot-instructions.md`
- Maintains `.mimo-context.md` as persistent memory across sessions
- Progress checkpoints every 20 iterations with status summary

### Chat Participant

Works with Antigravity/VS Code native chat via `@MiMo`.

> **Note:** Native model picker integration depends on Antigravity support for the `LanguageModelChatProvider` API. If MiMo doesn't appear in the model picker, use the dedicated chat panel.

## Setup

### 1. Install

**From VSIX:**
1. Download the latest `.vsix` from [Releases](https://github.com/drdelco/mimo-provider/releases)
2. Open Antigravity/VS Code > Extensions (`Ctrl+Shift+X`)
3. Menu `...` > "Install from VSIX..." > select the file

**From Open VSX** (Antigravity):
1. Open Extensions > Search **"MiMo by Xiaomi"**
2. Click Install

### 2. Configure your API key

1. `Ctrl+Shift+P` > **"MiMo: Configure API Key"**
2. Enter your Xiaomi MiMo API key

Get your API key at [platform.xiaomimimo.com](https://platform.xiaomimimo.com/)

### 3. Start chatting

- Click the **M** icon in the Activity Bar to open the chat panel
- Type your request and press Enter

## Chat Controls

| Control | Action |
|---------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| Clip button | Attach file as context |
| Chart button | View token usage and quota link |
| Stop button | Abort processing (shown during work) |
| New button | Clear history and start fresh |

## Commands

| Command | Description |
|---------|-------------|
| `MiMo: Configure API Key` | Set or update your API key and base URL |
| `MiMo: Test Connection` | Verify API connectivity and list available models |
| `MiMo: Open Chat Panel` | Open the dedicated MiMo chat in an editor tab |
| `MiMo: New Chat` | Clear conversation and start fresh |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `mimo.apiKey` | `""` | Xiaomi MiMo API key |
| `mimo.baseUrl` | `https://token-plan-ams.xiaomimimo.com/v1` | API base URL |

## Requirements

- Google Antigravity or VS Code 1.90+
- Xiaomi MiMo API key ([platform.xiaomimimo.com](https://platform.xiaomimimo.com/))

## License

MIT
