# 🎼 MiMonster Orchestra — Antigravity / VS Code Extension

A multi-AI coding assistant with two modes:

1. **Single-agent chat** — polished sidebar with **Xiaomi MiMo**, **DeepSeek**, **Kimi (Moonshot)**, **MiniMax**, and **Claude** as language model providers.
2. **Multi-agent Orchestra** — autonomous orchestration: an architect agent plans the work, multiple agents execute Work Orders in parallel, a security reviewer audits the result, and the architect synthesizes a final report.

> Previously published as "MiMo by Xiaomi" — same package id (`mimo-provider`), same publisher. Existing installations upgrade in place.

Full history in [CHANGELOG.md](CHANGELOG.md).

---

## 🎼 Orchestra (Multi-Agent Mode)

Run `Orchestra: Execute Complex Task` from the command palette and describe a non-trivial coding task. The pipeline runs four phases:

| Phase | Description | Default agent |
|-------|-------------|---------------|
| **1. Plan** | Architect breaks the request into Work Orders with deliverables, acceptance criteria, and dependencies | Kimi |
| **2. Execute** | Work Orders run **in parallel** via DAG resolution. Each agent uses real file/shell tools and can talk to peers via the Mailbox (`ask_agent`, `notify`, `broadcast`) | MiMo + DeepSeek + MiniMax |
| **3. Security** | Mandatory audit of all touched files (OWASP Top 10, secrets, injection patterns) | Claude |
| **4. Synthesize** | Architect produces the final report with cost, files changed, and security findings | Kimi |

### What you get

- **Massively parallel**: Kimi supports up to 300 concurrent agent instances; DeepSeek 50; MiniMax 20; MiMo 10; Claude 5
- **Auto-fallback**: if a provider fails on a Work Order, the next preferred provider takes over with full context transfer
- **Inter-agent messaging**: agents can pause and ask each other questions during execution
- **TF-IDF semantic memory**: each new agent receives semantically relevant context from prior Work Orders and messages
- **Live sidebar view** (`mimo.orchestraView`): real-time activity feed showing every agent's status, tool calls, messages, and security findings
- **Budget guard**: configurable USD limit per orchestration (default $5)
- **Acceptance criteria**: each Work Order ships with explicit testable checks

### When to use Orchestra

Good fit:
- "Add JWT auth with refresh tokens, role-based access, and rate limiting"
- "Migrate this module from REST to GraphQL with full test coverage"
- "Audit the codebase for SQL injection risks and propose fixes"
- "Build a CRUD page for X following the patterns in folders A and B"

Not a good fit:
- One-line bug fixes (use single-agent chat instead — it's faster and cheaper)
- Open-ended exploration with no defined output

---

## 💬 Single-Agent Chat

Click the activity bar icon for the sidebar chat, or open a tab via `MiMonster: Open Chat Panel`.

### Models

Models are **loaded dynamically** from each provider's API at startup. The extension fetches the latest available model list and populates the selector automatically. If an API is unreachable, it falls back to built-in defaults.

| Provider | Models | API Key prefix | Auth |
|----------|--------|----------------|------|
| **Xiaomi MiMo** | mimo-v2-pro, mimo-v2-flash, mimo-v2-omni | `tp-...` or `sk-...` | API key |
| **DeepSeek** | deepseek-chat, deepseek-reasoner | `sk-...` | API key |
| **Kimi (Moonshot)** | kimi-k2, kimi-latest, moonshot-v1-auto | `sk-...` | API key or OAuth |
| **MiniMax** | MiniMax-M1, MiniMax-M2.5, abab7 | `sk-...` | API key or OAuth |
| **Claude** | claude-sonnet-4 | `sk-ant-...` | API key (used by Orchestra security review) |

The extension automatically selects the best model for each step:
- **Pro** (or equivalent reasoning model) for complex multi-step tasks
- **Omni/Vision** variant when images are attached
- **Flash** for simple read/search operations (if enabled)

You can also pick a specific model manually from the dropdown in the chat panel.

### Chat features

- Sidebar panel + multi-tab chat panels with persistence across IDE sessions
- Streaming responses with syntax highlighting and copy-code buttons
- Markdown rendering, image paste (`Ctrl+V`), file attachment for context
- Token usage tracking, stop/cancel running tasks
- Send messages while the agent is working — injected into the next step
- Smart context: auto-loads `CLAUDE.md`, `.cursorrules`, `AGENTS.md`, `.mimo-context.md`, etc.
- Web search via Xiaomi plugin or DuckDuckGo fallback
- Export conversation as Markdown

### Coding tools (used by both modes)

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
| `web_search` / `fetch_url` | DuckDuckGo search + smart content extraction |

Orchestra agents additionally have:

| Tool | Description |
|------|-------------|
| `ask_agent` | Send a question to a peer agent, block until reply |
| `notify` | Fire-and-forget message to a peer |
| `broadcast` | Message all peer agents |
| `check_inbox` | Read pending messages |

---

## Setup

### 1. Install

**From VSIX:**
1. Download the latest `.vsix` from [Releases](https://github.com/drdelco/mimo-provider/releases)
2. Open Antigravity/VS Code > Extensions (`Ctrl+Shift+X`)
3. Menu `...` > "Install from VSIX..." > select the file

**From Open VSX** (Antigravity):
1. Open Extensions > Search **"MiMonster Orchestra"**
2. Click Install

### 2. Configure API keys

The minimum to start is one MiMo API key:

1. `Ctrl+Shift+P` > **"MiMonster: Configure API Key"**
2. Enter your Xiaomi MiMo API key (`tp-...` for Token Plan or `sk-...` for API)

Get your key at [platform.xiaomimimo.com](https://platform.xiaomimimo.com/).

For **Orchestra mode**, configure additional providers in Settings (`Ctrl+,` > search "mimo"):

- `mimo.deepseekApiKey` — [platform.deepseek.com](https://platform.deepseek.com/)
- `mimo.kimiApiKey` — [platform.moonshot.cn](https://platform.moonshot.cn/)
- `mimo.minimaxApiKey` — [platform.minimax.io](https://platform.minimax.io/)
- `mimo.claudeApiKey` — [console.anthropic.com](https://console.anthropic.com/) (used for security review)

### 3. (Optional) OAuth login for Kimi + MiniMax

If you have a paid Kimi or MiniMax subscription, you can log in directly:

1. `Ctrl+Shift+P` > **"MiMonster: Login to Kimi"** or **"MiMonster: Login to MiniMax"**
2. Browser opens → authenticate with your account
3. Token is stored encrypted in VS Code SecretStorage and auto-refreshes

OAuth tokens are used automatically when no API key is configured in settings.

---

## Commands

| Command | Description |
|---------|-------------|
| `MiMonster: Open Chat Panel` | New chat tab (multi-tab supported) |
| `MiMonster: Configure API Key` | Set or update your MiMo API key |
| `MiMonster: Test Connection` | Verify API connectivity |
| `MiMonster: New Chat` | Clear sidebar conversation |
| `MiMonster: Login to Kimi` / `Login to MiniMax` | OAuth login |
| `MiMonster: Logout from Kimi` / `Logout from MiniMax` | Clear OAuth tokens |
| `MiMonster: OAuth Login Status` | Check OAuth state for all providers |
| **`Orchestra: Execute Complex Task`** | Run a multi-agent orchestration |
| `Orchestra: Show Provider Status` | List configured providers |

---

## Settings

### Single-agent chat

| Setting | Default | Description |
|---------|---------|-------------|
| `mimo.apiKey` | `""` | MiMo API key |
| `mimo.baseUrl` | auto-detected | API endpoint |
| `mimo.preferredModel` | `auto` | `auto`, `mimo-v2-pro`, or `mimo-v2-flash` |
| `mimo.useFlashForSimpleTasks` | `false` | Use Flash for simple tool calls |
| `mimo.webSearch` | `true` | Use Xiaomi's native Web Search plugin (DuckDuckGo fallback when disabled) |
| `mimo.deepseekApiKey` / `mimo.deepseekBaseUrl` | | DeepSeek configuration |
| `mimo.kimiApiKey` / `mimo.kimiBaseUrl` | | Kimi/Moonshot configuration |
| `mimo.minimaxApiKey` / `mimo.minimaxBaseUrl` | | MiniMax configuration |
| `mimo.claudeApiKey` / `mimo.claudeBaseUrl` | | Anthropic Claude configuration |

### Orchestra

| Setting | Default | Description |
|---------|---------|-------------|
| `orchestra.enabled` | `true` | Enable multi-agent orchestration |
| `orchestra.director` | `kimi` | Architect provider (`kimi`, `claude`, `mimo`, `minimax`) |
| `orchestra.budgetLimit` | `5.0` | Max USD per orchestration |
| `orchestra.autoFallback` | `true` | Retry failed Work Orders on next preferred provider |
| `orchestra.skipSecurityReview` | `false` | Skip the mandatory security audit (not recommended) |
| `orchestra.poolLimits` | `{ kimi: 300, deepseek: 50, mimo: 10, minimax: 20, claude: 5 }` | Max concurrent agents per provider |

---

## Requirements

- Google Antigravity or VS Code 1.90+
- At least one API key **or** OAuth login:
  - **Xiaomi MiMo**: [platform.xiaomimimo.com](https://platform.xiaomimimo.com/)
  - **DeepSeek**: [platform.deepseek.com](https://platform.deepseek.com/)
  - **Kimi (Moonshot)**: [platform.moonshot.cn](https://platform.moonshot.cn/)
  - **MiniMax**: [platform.minimax.io](https://platform.minimax.io/)
  - **Anthropic Claude**: [console.anthropic.com](https://console.anthropic.com/)

For Orchestra, configuring **at least 2 providers** is recommended so the architect, coder, reviewer, and security roles can be served by different models.

---

## License

MIT
