# MiMo by Xiaomi — Antigravity / VS Code Extension

Use **Xiaomi MiMo** language models as a full coding agent inside Google Antigravity and VS Code.

## Models

| Model | ID | Context | Output | Best for |
|-------|----|---------|--------|----------|
| **MiMo V2 Pro** | `mimo-v2-pro` | 1M tokens | 128K | Complex reasoning, architecture, multi-step tasks |
| **MiMo V2 Omni** | `mimo-v2-omni` | 256K tokens | 128K | Multimodal — images, screenshots, diagrams + reasoning |
| **MiMo V2 Flash** | `mimo-v2-flash` | 256K tokens | 64K | Fast responses, simple tool calls |

The extension automatically selects the best model: **Pro** for complex work, **Omni** when images are involved, **Flash** for simple read/search operations (if enabled).

## Features

### Chat Panel

- Sidebar panel (click the **M** icon in the Activity Bar)
- **Multi-tab**: each `MiMo: Open Chat Panel` opens a new independent tab — run multiple agents in parallel
- Conversation history with context awareness
- Quick action buttons: Explain, Refactor, Debug, Test
- Markdown rendering with code blocks
- File attachment for context
- Token usage tracking
- Stop/cancel running tasks
- Send messages while MiMo works — injected into the next step
- Conversation persists between IDE sessions

### Coding Agent (9 Tools)

| Tool | Description |
|------|-------------|
| `read_file` | Read with line numbers, offset/limit for large files |
| `write_file` | Create new files or complete rewrites |
| `edit_file` | Surgical edits with uniqueness validation and `replace_all` support |
| `run_terminal` | Async shell commands, up to 300s timeout, doesn't block the IDE |
| `search_files` | Cross-platform regex search with context lines |
| `list_files` | Directory listing with glob filtering |
| `find_files` | Fast workspace-wide glob search via VS Code API |
| `get_diagnostics` | Errors/warnings from the VS Code Problems panel |
| `read_image` | Analyze images (screenshots, UI, diagrams) via MiMo V2 Omni |

All tools are **cross-platform** (Windows, macOS, Linux) — no shell dependency.

### Smart Context

- **Auto-detects OS** and injects correct shell commands
- **Auto-detects API key type**: `tp-*` keys route to Token Plan endpoint, `sk-*` keys to API endpoint
- **Git awareness**: current branch, modified files, and recent commits injected into prompt
- **Auto-loads project context files**: `CLAUDE.md`, `.claude/rules/`, `.cursorrules`, `AGENTS.md`, `.github/copilot-instructions.md`, `.mimo-context.md`
- **Prompt caching**: system prompt cached for 60s to avoid redundant file reads
- **Context compression**: old messages are compressed into structured summaries instead of being dropped
- **Deep thinking**: enabled for Pro and Omni models (chain-of-thought reasoning)

### Web Search (optional)

MiMo can search the web for documentation, current events, and external resources. Requires:
1. Enable the Web Search plugin at [platform.xiaomimimo.com](https://platform.xiaomimimo.com) > Plugin Management
2. Set `mimo.webSearch` to `true` in VS Code settings

### Chat Participant

Works with Antigravity/VS Code native chat via `@MiMo`.

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
2. Enter your Xiaomi MiMo API key (`tp-...` for Token Plan or `sk-...` for API)

Get your key at [platform.xiaomimimo.com](https://platform.xiaomimimo.com/)

### 3. Start chatting

- Click the **M** icon in the Activity Bar for the sidebar chat
- Or run `MiMo: Open Chat Panel` to open a new tab (each tab is an independent conversation)

## Commands

| Command | Description |
|---------|-------------|
| `MiMo: Open Chat Panel` | Open a new MiMo chat tab (multi-agent) |
| `MiMo: Configure API Key` | Set or update your API key |
| `MiMo: Test Connection` | Verify API connectivity |
| `MiMo: New Chat` | Clear sidebar conversation |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `mimo.apiKey` | `""` | MiMo API key (`tp-...` or `sk-...`) |
| `mimo.baseUrl` | auto-detected | API endpoint (auto-detected from key prefix) |
| `mimo.webSearch` | `false` | Enable web search (requires plugin activation) |
| `mimo.useFlashForSimpleTasks` | `false` | Use Flash for simple tool calls (only if your plan includes Flash) |

## Requirements

- Google Antigravity or VS Code 1.90+
- Xiaomi MiMo API key ([platform.xiaomimimo.com](https://platform.xiaomimimo.com/))

## License

MIT
