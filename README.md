# MiMo by Xiaomi — Antigravity / VS Code Extension

Use **Xiaomi MiMo** language models as a full coding agent inside Google Antigravity and VS Code.

## Models

| Model | ID | Context | Best for |
|-------|-----|---------|----------|
| **MiMo V2 Pro** | `mimo-v2-pro` | 262K tokens | Advanced reasoning, complex coding tasks |
| **MiMo V2 Flash** | `mimo-v2-flash` | 262K tokens | Fast responses, quick edits |

## Features

### 💬 Chat Panel
- Sidebar panel with its own chat interface (click the **M** icon in the Activity Bar)
- Full conversation history with context awareness
- Quick action buttons: Explain, Refactor, Debug, Test
- Markdown rendering with code highlighting
- One-click "Insert into editor" for generated code

### 📎 File Context
- Attach files directly to your messages with the 📎 button
- Files are read and injected into the conversation as context
- Supports all code file types (TS, JS, Python, CSS, HTML, JSON, MD, etc.)

### 📊 Token Usage
- Track session token consumption with the 📊 button
- Direct link to [MiMo Platform](https://platform.xiaomimimo.com/#/console/plan-manage) to check remaining quota

### ⏹ Stop / Cancel
- Stop button appears during processing to abort running tasks
- Cancel infinite loops or wrong commands instantly

### 📨 Live Message Injection
- Send new messages while MiMo is processing — they get injected into the next tool step
- MiMo incorporates your feedback mid-task without waiting

### 🧠 Smart Context Management
- Automatically reads existing context files at session start:
  - `CLAUDE.md` — Claude Code project rules
  - `.claude/rules/` — Scoped rules
  - `.agent/` — Antigravity memory files
  - `.mimo-context.md` — MiMo's own persistent memory
  - `.cursorrules`, `AGENTS.md`, `.github/copilot-instructions.md`
- Maintains `.mimo-context.md` as a persistent memory file across sessions

### ⏱️ Progress Checkpoints
- Automatic progress summary every 20 iterations
- MiMo reports what it has done, what remains, and if it's stuck

### 🛠️ Coding Agent
MiMo can autonomously:
- **Read** files to understand your codebase
- **Write** new files and create directory structures
- **Edit** specific parts of existing files (surgical edits)
- **Run** terminal commands (builds, tests, git, npm, etc.)
- **Search** across files using grep patterns
- **List** directory contents
- **Check** diagnostics (errors & warnings from VS Code)

### 🔌 Chat Participant
- Works with Antigravity/VS Code native chat via `@MiMo`
- Note: The native model picker integration depends on Antigravity support for the `LanguageModelChatProvider` API. If MiMo doesn't appear in the model picker, use the dedicated chat panel or `@MiMo` in native chat.

## Setup

### 1. Install

**From VSIX:**
1. Download the latest `.vsix` from the [releases](#) or [Open VSX](https://open-vsx.org)
2. Open Antigravity/VS Code → Extensions (`Ctrl+Shift+X`)
3. `⋮` menu → "Install from VSIX..." → select the file

**From Open VSX** (Antigravity):
1. Open Extensions → Search **"MiMo by Xiaomi"**
2. Click Install

### 2. Configure your API key

1. `Ctrl+Shift+P` → **"MiMo: Configure API Key"**
2. Enter your Xiaomi MiMo API key

Get your API key at [platform.xiaomimimo.com](https://platform.xiaomimimo.com/)

### 3. Start chatting

- Click the **M** icon in the Activity Bar to open the dedicated chat panel
- Type your request and press Enter

> **Note:** Native chat integration (`@MiMo` and model picker) is not currently supported by Antigravity. Use the dedicated chat panel for full MiMo functionality.

## Chat Controls

| Control | Action |
|---------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in message |
| `📎` | Attach file as context |
| `📊` | View token usage + quota link |
| `⏹` | Stop processing (shown during work) |
| `🗑️ New` | Clear history and start fresh |

## Usage Examples

```
Read the file src/api.ts and explain what it does
```

```
Find all TODO comments in the project and create a summary
```

```
Create a React component for a user profile card with TypeScript and Tailwind
```

```
Run the tests and fix any failures
```

```
Refactor the database connection code to use connection pooling
```

## Commands

| Command | Description |
|---------|-------------|
| `MiMo: Configure API Key` | Set or update your API key and base URL |
| `MiMo: Test Connection` | Verify API connectivity and list available models |
| `MiMo: Open Chat Panel` | Open the dedicated MiMo chat sidebar |
| `MiMo: New Chat` | Clear chat history and start fresh |
| `MiMo: Clear Chat History` | Clear conversation context |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `mimo.apiKey` | `""` | Xiaomi MiMo API key |
| `mimo.baseUrl` | `https://token-plan-ams.xiaomimimo.com/v1` | API base URL |

## How it works

This extension provides a dedicated chat panel powered by MiMo with full tool calling support. When you ask MiMo to perform an action, it decides which tools to use (read file, write file, run command, etc.) and executes them automatically, showing you each step.

> **Note:** Native VS Code chat integration (`@MiMo`, model picker) is not supported by Antigravity at this time.

## Requirements

- Google Antigravity or VS Code 1.90+
- Xiaomi MiMo API key ([platform.xiaomimimo.com](https://platform.xiaomimimo.com/))

## License

MIT
