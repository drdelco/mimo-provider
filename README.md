# MiMo by Xiaomi — Antigravity / VS Code Extension

Use **Xiaomi MiMo** language models as a full coding agent inside Google Antigravity and VS Code.

## What's new

- **0.9.4** — Multi-provider support: add DeepSeek API key in settings to use DeepSeek models alongside MiMo. Models from both providers are fetched in parallel and merged into a single selector. Routing is automatic based on model ID. DeepSeek's `reasoning_content` field is captured during SSE streaming.
- **0.9.3** — Fix: duplicate messages after SSE streaming; fix: image thumbnails not cleared after send; fix: auto-switch to vision model when images are attached to a non-vision model.
- **0.9.2** — Fixes the `defaultChatParticipant` activation error (extension was being blocked on launch). New: animated "thinking…" indicator, non-intrusive smart scroll, image paste from clipboard (`Ctrl+V`), dynamic model list from the API with auto-switch to vision variant on image attach, festive stats summary every 10 iterations, and auto-retry with fallback model on failure.
- **0.9.1** — Pre-flight checks added to the system prompt (9 rules from real-world failure modes); web search instructions consolidated.
- **0.9.0** — Real-time SSE streaming, model selector dropdown (Auto / Pro / Flash), export conversation as Markdown.
- **0.8.5** — Readability-style content extraction for `fetch_url`; lightweight in-chat syntax highlighting.
- **0.8.4** — DuckDuckGo rate-limit handling, auto-retry search, copy-code button.

Full history in [CHANGELOG.md](CHANGELOG.md).

## Models

Models are **loaded dynamically** from the Xiaomi MiMo API at startup. The extension fetches the latest available model list from `/models` and populates the selector automatically. If the API is unreachable, it falls back to a built-in default list.

The extension automatically selects the best model for each step:
- **Pro** (or equivalent reasoning model) for complex multi-step tasks
- **Omni/Vision** variant when images are attached
- **Flash** for simple read/search operations (if enabled)

You can also pick a specific model manually from the dropdown in the chat panel.

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
- **Image paste** (`Ctrl+V`): paste screenshots directly from clipboard with preview
- **Dynamic model selector**: dropdown populated from the API, auto-switches to vision variant on image attach
- **Animated thinking indicator** while MiMo processes
- **Smart scroll**: doesn't interrupt you when reading back — only auto-scrolls if you're already at the bottom
- **Festive stats summary** every 10 iterations with tool/file counts
- **Auto-retry with fallback model** on API failure

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
| `read_image` | Analyze images (screenshots, UI, diagrams) via vision-capable models |

All tools are **cross-platform** (Windows, macOS, Linux) — no shell dependency.

### Smart Context

- **Auto-detects OS** and injects correct shell commands
- **Auto-detects API key type**: `tp-*` keys route to Token Plan endpoint, `sk-*` keys to API endpoint
- **Git awareness**: current branch, modified files, and recent commits injected into prompt
- **Auto-loads project context files**: `CLAUDE.md`, `.claude/rules/`, `.cursorrules`, `AGENTS.md`, `.github/copilot-instructions.md`, `.mimo-context.md`
- **Prompt caching**: system prompt cached for 60s to avoid redundant file reads
- **Context compression**: old messages are compressed into structured summaries instead of being dropped
- **Deep thinking**: enabled for Pro and Omni models (chain-of-thought reasoning)
- **Dynamic model loading**: fetches available models from the API on startup, with fallback to built-in defaults

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
| `mimo.preferredModel` | `"auto"` | Preferred model (`auto`, `mimo-v2-pro`, `mimo-v2-flash`). Auto selects Pro for complex tasks and Flash for simple tool calls |
| `mimo.useFlashForSimpleTasks` | `false` | Use Flash for simple tool calls (only if your plan includes Flash) |
| `mimo.webSearch` | `true` | Enable Xiaomi's native Web Search plugin (requires activation at [platform.xiaomimimo.com](https://platform.xiaomimimo.com) > Plugin Management). When disabled, uses free DuckDuckGo-based local search as fallback |

## Requirements

- Google Antigravity or VS Code 1.90+
- Xiaomi MiMo API key ([platform.xiaomimimo.com](https://platform.xiaomimimo.com/))

## License

MIT
