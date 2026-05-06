# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**mimo-provider** is a VS Code extension that integrates Xiaomi's MiMo language models (V2 Pro and V2 Flash) as a native coding assistant. It provides:
- A **Language Model Chat Provider** (streaming via SSE)
- A **VS Code Chat Participant** (`@MiMo`, agentic tool-calling loop)
- A **Webview Chat Panel** (sidebar with embedded HTML/CSS/JS UI)

Published to Open VSX Registry. Requires VS Code 1.90.0+ and a Xiaomi MiMo API key.

## Build Commands

```bash
npm run compile      # Compile TypeScript → ./out/
npm run watch        # Watch mode compilation
npm run package      # Package as .vsix for distribution
```

No runtime dependencies — only devDependencies (`typescript`, `@types/vscode`, `@types/node`). All runtime uses built-in Node.js modules and VS Code API.

## Architecture

Entry point: `src/extension.ts` → compiles to `out/extension.js` (CommonJS, ES2022).

### Core Modules

| Module | Class/Export | Role |
|--------|-------------|------|
| `src/provider.ts` | `MiMoProvider` | Language Model Chat Provider. Streams responses via SSE to `/chat/completions`. Exposes two models: `mimo-v2-pro` and `mimo-v2-flash` (262K context, 8K output each). |
| `src/chat.ts` | `MiMoChatParticipant` | VS Code Chat Participant. Non-streaming agentic loop with tool calling. 500-iteration safety cap, progress checkpoints every 20 iterations. Keeps last 20-30 messages in history. |
| `src/tools.ts` | `TOOLS`, `executeTool()` | 7 OpenAI-compatible tool definitions (read_file, write_file, edit_file, run_terminal, search_files, list_files, get_diagnostics) with execution logic. |
| `src/webview.ts` | `MiMoChatViewProvider` | Webview sidebar panel. Contains embedded HTML/CSS/JS UI, token tracking, file attachment, pending message queue for mid-loop injection. |

### Data Flow

1. **Provider path**: User → VS Code Language Model API → `MiMoProvider` → SSE stream from MiMo API → streamed tokens back
2. **Chat participant path**: User → `@MiMo` in VS Code chat → `MiMoChatParticipant` → non-streaming API call with tools → iterative tool execution loop → final response
3. **Webview path**: User → sidebar webview UI → `MiMoChatViewProvider` → MiMo API (streaming) with tool calls → results rendered in webview

### API Integration

- **Base URL**: `https://token-plan-ams.xiaomimimo.com/v1`
- **Endpoints**: `/models` (list), `/chat/completions` (stream or non-stream)
- **Auth**: Bearer token via `mimo.apiKey` setting
- **Timeouts**: 120s API, 30s terminal commands, 15s search, 10s list files

### System Prompt

Both `chat.ts` and `webview.ts` embed an identical system prompt instructing MiMo to explore before editing, use surgical edits, detect OS, read context files, and maintain `.mimo-context.md` for session memory.

## Output Limits

- File reads: 50K chars
- Tool results in chat: 2K chars
- Search results: 8K chars
- Terminal output: 10K chars
- Diagnostics: 50 items max

## Extension Settings

- `mimo.apiKey` — MiMo API key (string)
- `mimo.baseUrl` — API endpoint (default: `https://token-plan-ams.xiaomimimo.com/v1`)

## Testing the Extension

No test framework is configured. To test manually:
1. `npm run compile`
2. Press F5 in VS Code to launch Extension Development Host
3. Configure API key via command palette → "MiMo: Configure API Key"
4. Test connection via "MiMo: Test Connection"

## Key Design Decisions

- **Zero runtime dependencies**: Everything uses Node.js built-ins (`fs`, `path`, `child_process`) and VS Code API
- **Embedded webview UI**: All HTML/CSS/JS is inlined in `webview.ts` rather than separate files
- **Dual system prompt**: The same agent instructions are duplicated in `chat.ts` and `webview.ts` — changes must be synced in both
- **Token estimation**: Uses ~4 chars per token heuristic (Chinese/English mixed content)
- **Shell detection**: Auto-detects Windows (CMD/PowerShell) vs Unix (bash) for tool execution
