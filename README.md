# MiMo by Xiaomi — Antigravity / VS Code Extension

Use **Xiaomi MiMo**, **DeepSeek**, **Kimi (Moonshot)**, **MiniMax** and **OpenRouter** language models as a full coding agent inside Google Antigravity and VS Code.

Full history in [CHANGELOG.md](CHANGELOG.md).

## Models

Models are **loaded dynamically** from each provider's API at startup. The extension fetches the latest available model list and populates the selector automatically. If an API is unreachable, it falls back to built-in defaults.

| Provider | Models | API Key prefix |
|----------|--------|----------------|
| **Xiaomi MiMo** | mimo-v2-pro, mimo-v2-flash, mimo-v2-omni | `tp-...` or `sk-...` |
| **DeepSeek** | deepseek-chat, deepseek-reasoner | `sk-...` |
| **Kimi (Moonshot)** | kimi-k2, kimi-latest, moonshot-v1-auto | `sk-...` |
| **MiniMax** | MiniMax-M2.5, MiniMax-M2.3, abab7, abab6.5s | `sk-...` |
| **OpenRouter** | Any model on [openrouter.ai](https://openrouter.ai) (Claude, GPT, Gemini, Llama, etc.) | `sk-or-...` |

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

**Other providers** — set keys in Settings (`Ctrl+,` > search "MiMo"):
- `mimo.deepseekApiKey` — [platform.deepseek.com](https://platform.deepseek.com/)
- `mimo.kimiApiKey` — [platform.moonshot.cn](https://platform.moonshot.cn/)
- `mimo.minimaxApiKey` — [platform.minimax.io](https://platform.minimax.io/)
- `mimo.openrouterApiKey` — [openrouter.ai](https://openrouter.ai)

### OAuth Login (Kimi + MiniMax)

If you have a **Kimi** or **MiniMax** subscription, you can log in directly without an API key:

1. `Ctrl+Shift+P` > **"MiMo: Login to Kimi"** or **"MiMo: Login to MiniMax"**
2. Browser opens → authenticate with your account
3. Extension receives a secure token (stored encrypted in VS Code)
4. Token auto-refreshes — no manual management needed

OAuth tokens are used automatically when no API key is configured in settings.

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
| `MiMo: Login to Kimi` | OAuth login with Kimi/Moonshot account |
| `MiMo: Login to MiniMax` | OAuth login with MiniMax account |
| `MiMo: OAuth Login Status` | Check OAuth login status for all providers |
| `MiMo: Logout from Kimi` | Clear Kimi OAuth token |
| `MiMo: Logout from MiniMax` | Clear MiniMax OAuth token |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `mimo.apiKey` | `""` | MiMo API key (`tp-...` or `sk-...`) |
| `mimo.baseUrl` | auto-detected | API endpoint (auto-detected from key prefix) |
| `mimo.preferredModel` | `"auto"` | Preferred model (`auto`, `mimo-v2-pro`, `mimo-v2-flash`). Auto selects Pro for complex tasks and Flash for simple tool calls |
| `mimo.useFlashForSimpleTasks` | `false` | Use Flash for simple tool calls (only if your plan includes Flash) |
| `mimo.webSearch` | `true` | Enable Xiaomi's native Web Search plugin (requires activation at [platform.xiaomimimo.com](https://platform.xiaomimimo.com) > Plugin Management). When disabled, uses free DuckDuckGo-based local search as fallback |
| `mimo.deepseekApiKey` | `""` | DeepSeek API key (`sk-...`). Get at [platform.deepseek.com](https://platform.deepseek.com/) |
| `mimo.kimiApiKey` | `""` | Kimi/Moonshot API key (`sk-...`). Get at [platform.moonshot.cn](https://platform.moonshot.cn/) |
| `mimo.minimaxApiKey` | `""` | MiniMax API key (`sk-...`). Get at [platform.minimax.io](https://platform.minimax.io/) |
| `mimo.openrouterApiKey` | `""` | OpenRouter API key (`sk-or-...`). Get at [openrouter.ai](https://openrouter.ai) |

## Requirements

- Google Antigravity or VS Code 1.90+
- At least one API key **or** OAuth login:
  - **Xiaomi MiMo**: [platform.xiaomimimo.com](https://platform.xiaomimimo.com/) (API key)
  - **DeepSeek**: [platform.deepseek.com](https://platform.deepseek.com/) (API key)
  - **Kimi (Moonshot)**: [platform.moonshot.cn](https://platform.moonshot.cn/) (API key or **OAuth login**)
  - **MiniMax**: [platform.minimax.io](https://platform.minimax.io/) (API key or **OAuth login**)
  - **OpenRouter**: [openrouter.ai](https://openrouter.ai) (API key)

## License

MIT
