# Changelog

## 0.5.1 (2026-04-11)

- **Web search fix**: web_search tool only sent when `mimo.webSearch` setting is enabled (fixes API 400 error)
- **Feedback order**: MiMo now puts the summary after tool activity, not before
- **Chatbox width**: max-width 80% centered in tab view

## 0.5.0 (2026-04-11)

### External webview architecture

Moved all browser JavaScript and CSS to external files (`media/webview.js`, `media/webview.css`). This eliminates the template literal escaping bugs that prevented buttons and Enter from working. The webview script is now standard JavaScript with zero escape layers.

### New chatbox design

Clean input area inspired by Claude Code:
- Input row with rounded border, integrated send button
- Toolbar below: `+ File`, `Usage` (left), `Stop`, `New chat` (right)
- No header — clean and direct
- Assistant messages without bubbles
- Discrete tool call display

### Multi-tab (multi-agent)

Each `MiMo: Open Chat Panel` opens a **new independent tab** (`MiMo #1`, `MiMo #2`, ...). Each tab has its own conversation history — run multiple agents in parallel on different tasks.

## 0.4.0 (2026-04-11)

### Correct model specifications

Updated from API documentation at platform.xiaomimimo.com:
- **MiMo V2 Pro**: 1M context, 128K output (was 262K/8K)
- **MiMo V2 Flash**: 256K context, 64K output (was 262K/8K)
- **MiMo V2 Omni**: NEW — 256K context, 128K output, multimodal (images, audio, video)

### Smart model switching

Automatic model selection per iteration:
- **Pro**: complex reasoning, editing, writing (default)
- **Omni**: when images are involved (`read_image` tool)
- **Flash**: simple tool calls (read, search, list) — only if enabled and available in plan

### API key auto-detection

- `tp-*` keys route to `token-plan-ams.xiaomimimo.com/v1`
- `sk-*` keys route to `api.xiaomimimo.com/v1`
- Eliminates 404 errors from wrong endpoint

### Web search

Web search tool available via MiMo API (requires plugin activation at platform.xiaomimimo.com).

### Vision support

New `read_image` tool: reads local images (PNG, JPG, GIF, WebP, BMP) and analyzes them using MiMo V2 Omni. For screenshots, UI mockups, diagrams.

### Deep thinking

`thinking: { type: "enabled" }` sent for Pro and Omni models. Chain-of-thought reasoning for better quality on complex tasks.

### `max_completion_tokens`

Correct API parameter (was `max_tokens`). Pro can output up to 128K tokens per response.

## 0.3.0 (2026-04-11)

### Tools rewrite (cross-platform)

All tools rewritten in pure Node.js — no more shell dependency (`grep`, `find`, `ls`). Works on Windows, macOS, and Linux.

- **read_file**: line numbers (`cat -n` style), `offset`/`limit` for ranges, 2MB file guard
- **edit_file**: uniqueness check (fails if `old_content` matches multiple locations), `replace_all` parameter, near-match hints on failure
- **run_terminal**: async (`exec` not `execSync`) — doesn't block the IDE. Timeout up to 300s. Catastrophic command guard
- **search_files**: pure Node.js regex search, `context_lines` parameter, binary file skip
- **list_files**: sorted dirs-first, file sizes, glob filter
- **find_files**: NEW — uses `vscode.workspace.findFiles` for fast glob search
- **get_diagnostics**: increased limits (80 items)

### Context compression

When conversation exceeds 40 messages, old messages are compressed into a structured summary (files read/modified, commands run, last assistant response) instead of being dropped. No API calls needed — deterministic extraction.

### Git awareness

System prompt includes: current branch, git user, modified files (`git status`), recent commits.

### Prompt caching

System prompt cached for 60s. Invalidated on "New Chat".

### Conversation persistence

History saved to `workspaceState` — survives IDE restarts.

## 0.2.0 (2026-04-11)

### Fixes

- Panel editor buttons — all message types now delegated to shared handler
- View routing — clean `setActiveWebview`/`clearActiveWebview` pattern
- Progress messages — added `stream` case to webview message handler
- Clear button — quick action listeners re-bound after clearing
- Stale DOM reference — dynamic `getElementById` lookup

### Improvements

- Shared system prompt (`prompt.ts`)
- Dynamic OS injection via `process.platform`
- Auto-load context files (CLAUDE.md, .cursorrules, etc.)
- Workspace info in prompt
- Leaner prompt — removed verbose sections

## 0.1.0 (2026-04-10)

Initial release with MiMo V2 Pro and Flash models, chat panel, 7 coding tools, VS Code chat participant integration.
