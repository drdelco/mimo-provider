# Changelog

## 1.1.0 (2026-05-02)

### OAuth login for Kimi + MiniMax

- **feat:** OAuth device-code login for **Kimi** (Moonshot) — `MiMo: Login to Kimi`
- **feat:** OAuth device-code login for **MiniMax** — `MiMo: Login to MiniMax`
- **feat:** OAuth tokens stored securely in VS Code SecretStorage (encrypted, never in settings.json)
- **feat:** Auto-refresh tokens before expiry (60s buffer)
- **feat:** `resolveApiKey()` — settings API key → OAuth token fallback chain
- **feat:** `getProviderConfigAsync()` / `getApiConfigForModelAsync()` — OAuth-aware config resolution
- **feat:** `MiMo: OAuth Login Status` command to check login state for all providers
- **feat:** `MiMo: Logout from Kimi` / `MiMo: Logout from MiniMax` commands
- **feat:** Kimi OAuth uses `api.kimi.com/coding/v1` base URL when logged in
- **refactor:** chat.ts + webview.ts use async config resolution for OAuth support
- **docs:** README updated with all 5 providers, OAuth setup instructions, new commands and settings

## 1.0.0 (2026-05-02)

### MiniMax provider + v1.0.0 milestone

- **feat:** **MiniMax** provider support — models loaded from `api.minimax.io/v1/models`, supports `MiniMax-M2.5`, `MiniMax-M2.3`, `abab7`, `abab6.5s` and more
- **feat:** MiniMax uses DuckDuckGo fallback for web search (no native `$web_search` in chat API)
- **feat:** MiniMax models participate in cross-provider fallback chain
- **feat:** `mimo.minimaxApiKey` and `mimo.minimaxBaseUrl` configuration fields
- **fix:** Kimi and MiniMax models now correctly detected in `getApiConfigForModel()`
- **refactor:** `isDeepSeek` checks generalized to `needsDuckDuckGo` (covers DeepSeek + MiniMax)

## 0.9.9 (2026-05-02)

### Kimi settings fields

- **fix:** Added `mimo.kimiApiKey` and `mimo.kimiBaseUrl` configuration fields to `package.json` — Kimi API key is now configurable from VS Code settings UI.
- **fix:** Registered Kimi provider in `PROVIDERS` registry so it participates in cross-provider fallback.

## 0.9.8 (2026-05-02)

### Version bump

- Patch release with no functional changes from 0.9.7.

## 0.9.7 (2026-05-02)

### Kimi (Moonshot) provider + cross-provider fallback + README refresh

- **feat:** Kimi/Moonshot provider support — models loaded from `api.moonshot.cn/v1/models`, supports `kimi-k2`, `kimi-latest`, `moonshot-v1-auto` and more.
- **feat:** Kimi uses native `$web_search` (same `builtin_function` format as MiMo) — no DuckDuckGo fallback needed.
- **feat:** Cross-provider fallback system — if a model fails, the extension automatically tries other models from the same provider, then other providers, then hardcoded fallbacks. Failed models enter a 1-minute cooldown.
- **feat:** `kimi-install.sh` helper script for quick setup on macOS/Linux.
- **docs:** README restructured — removed "What's new" section (already in CHANGELOG), highlighted multi-provider support (MiMo + DeepSeek + Kimi) in header, added provider table with model names and key prefixes.

## 0.9.6 (2026-05-02)

### Fix: DeepSeek web search compatibility

- Xiaomi's `builtin_function` format (`$web_search`) is not compatible with DeepSeek's OpenAI-compatible API — it caused a 400 error (`missing field 'type'`). Now `WEB_SEARCH_TOOL` is only sent to MiMo models; DeepSeek uses the standard `LOCAL_WEB_TOOLS` (DuckDuckGo) instead.
- Thinking parameter is now also skipped for DeepSeek in the Copilot Chat participant (`chat.ts`), matching the webview behavior.

## 0.9.5 (2026-05-02)

### Fix: DeepSeek base URL

- The default `deepseekBaseUrl` was missing the `/v1` path segment, causing the `/models` endpoint to hit `https://api.deepseek.com/models` (404) instead of `https://api.deepseek.com/v1/models`. DeepSeek models now appear correctly in the selector.

## 0.9.4 (2026-05-02)

### Multi-provider support (DeepSeek)

- New settings: `mimo.deepseekApiKey` and `mimo.deepseekBaseUrl` (defaults to `https://api.deepseek.com/v1`).
- Models from both providers (MiMo + DeepSeek) are fetched in parallel at startup and merged into a single model selector.
- Routing is automatic: models prefixed with `deepseek-` are sent to the DeepSeek endpoint; everything else goes to MiMo.
- DeepSeek's `reasoning_content` field is captured during SSE streaming and displayed as thinking output.
- Thinking parameter is skipped for DeepSeek models (they handle reasoning internally).

## 0.9.3 (2026-05-02)

### Fix: Duplicate messages

- When SSE streaming sent tokens to the UI, the final response content was re-sent after tool calls completed, causing duplicated text. Added `wasStreamed` flag to `parseSSEResponse` — skips re-sending content that was already streamed token-by-token.

### Fix: Image thumbnails not cleared

- After pending images were consumed by the API, the thumbnail previews remained visible in the chat input. Now sends a `clearImages` message to the webview, which removes all `.image-preview` elements from the attached files area.

### Fix: Images ignored when model lacks vision

- If the active model doesn't support vision and images are attached, the extension now auto-switches to the first available vision-capable model for that request. If no vision model exists at all, images are cleared and the user is informed.

## 0.9.2 (2026-05-02)

### Fix: Marketplace activation error

- Removed `"isDefault": true` from the chat participant declaration. That property required the privileged `defaultChatParticipant` API proposal (reserved by VS Code for GitHub Copilot), which caused the runtime error `Extension 'drdelco.mimo-provider' CANNOT use API proposal: defaultChatParticipant` on activation.
- The participant keeps working via `@MiMo` mention in the native chat.

### Waiting animation

- Animated "MiMo is thinking…" indicator with pulsing dots while the model processes. Starts on message send, stops when the response arrives.

### Smart scroll

- The chat no longer forces the view back to the bottom when new tokens arrive if the user has scrolled up to read previous output. Auto-scroll only kicks in when the user is already near the end (80px threshold).

### Festive iteration summary

- Every 10 agent iterations, a special status message is rendered with stats: tools used, files read, files modified, and elapsed time.

### Image paste from clipboard

- `Ctrl+V` with an image on the clipboard (e.g. a screenshot) attaches it directly to the chat. A removable preview is shown before sending.

### Dynamic model selector with vision auto-switch

- The model dropdown is now loaded dynamically from the Xiaomi API (`GET /models`). Capabilities (vision, thinking) are inferred from the model ID/name.
- When an image is attached, the active model auto-switches to its vision-capable variant (e.g. `MiMo-V2-Flash` → `MiMo-V2-Flash-V`).

### Auto-retry with fallback model

- If the primary model fails, the request is automatically retried with an alternative model before surfacing the error to the user.

## 0.9.1 (2026-04-21)

### Pre-flight checks

- New "Pre-flight Checks" section in the system prompt with 9 rules derived from real-world failure modes:
  1. Cross-project copy-paste — never assume Firestore paths, custom claims, or env vars match across sibling projects.
  2. SPA + hosting routing — read `rewrites` before adding links.
  3. Deploy target disambiguation — distinguish Functions v1 (CommonJS) vs v2 (TS); avoid editing dead codebases.
  4. Avoid hardcoded large data — no inline >5KB strings; import from canonical source.
  5. No duplicate exports — search before exporting to prevent silent shadowing.
  6. End-to-end verification — simulate the user's click before claiming "done".
  7. Always run build — finish TS tasks with a build + report.
  8. Respect existing patterns — don't create parallel systems.
  9. Surgical edits in giant files — prefer `edit_file` over Python/sed scripts.

### Web rules consolidation

- Merged duplicate URL/web instructions between "Web Search" and "Rules" sections into a single bullet under Rules.
- Compacted the "Web Search" section to the essentials (tools + workflow).

## 0.9.0 (2026-04-14)

### Streaming responses

- **Real-time token streaming** via SSE — the final response now appears word-by-word instead of arriving all at once after a long silent wait.
- Streaming applies to ALL iterations: content tokens appear in real-time, tool call deltas are accumulated silently.
- `streamStart` / `assistantDone` lifecycle messages for proper UI management.
- Insert code button added after streaming completes.

### Model selector

- **Model dropdown** in the toolbar — switch between Auto, Pro, and Flash without going to settings.
- Auto mode (default): Pro for complex tasks, Flash for simple tool calls.
- Selection persists per workspace via `mimo.preferredModel` setting.

### Export conversation

- **Export button** in the toolbar — opens the conversation as a formatted Markdown document.
- User and assistant messages exported with `## User` / `## MiMo` headings.

## 0.8.5 (2026-04-14)

### Smart content extraction

- **Readability-like extraction**: `fetch_url` now tries to isolate `<article>`, `<main>`, `role="main"`, or common content classes (`article-body`, `post-content`, `entry-content`, etc.) before processing. Falls back to full page if no main block found.
- Dramatically reduces noise from navigation, sidebars, and footers — cleaner output, fewer wasted tokens.

### Syntax highlighting

- **Lightweight code coloring** in chat code blocks — keywords (blue), strings (orange), comments (green/italic), numbers (green), types (teal).
- Zero external dependencies — regex-based highlighter covers JS/TS, Python, Rust, Go, and most C-family languages.
- Uses VS Code theme variables for colors, adapting to light/dark themes.
- Language class preserved on `<code>` elements (`lang-typescript`, `lang-python`, etc.).

## 0.8.4 (2026-04-14)

### Search reliability

- **DuckDuckGo rate limiting protection**: 1.2s delay between consecutive DDG requests prevents rate limiting.
- **Auto-retry with shorter query**: when search returns 0 results, automatically retries with a shortened query (removing stop words). Shows both attempted queries.
- Stop word list covers English and Spanish.

### Copy code button

- **Copy button on code blocks**: appears on hover, copies code to clipboard. Uses `navigator.clipboard` with VS Code API fallback.
- Code blocks now wrapped in `.code-block` container for consistent styling.

## 0.8.3 (2026-04-13)

### Process feedback improvements

- **Descriptive step indicators**: "Step 1 — Analyzing your request..." / "Step 3 — Continuing after reading file..." instead of generic "calling MiMo...".
- **Progress summaries every 5 steps**: shows files read, files modified, searches and commands run — visible to the user without interrupting MiMo.
- **Final response indicator**: "Done — N steps completed. Writing response..." shown while MiMo generates the final answer, eliminating the silent wait.
- Tool activity tracking (files read, files modified, searches, commands) throughout the session.

## 0.8.1 (2026-04-12)

### Improved HTML parser

- **Aggressive noise removal**: strips `<nav>`, `<aside>`, `<form>`, `<button>`, `<select>`, `<svg>`, `<iframe>`, `<noscript>`, cookie/consent banners, sidebars, menus, ad blocks, social share widgets, and other non-content elements.
- **Markdown conversion**: headings become `#`/`##`/`###`, list items become `- `, links become `[text](url)` — much cleaner output for the model.
- **Short line filtering**: removes single-character noise lines (empty nav items, stray icons).
- Fetched pages now consume significantly fewer tokens and contain more useful content.

### Date awareness

- System prompt now includes today's date at the top: "Today is sábado, 12 de abril de 2026". MiMo no longer defaults to its training date.

### Web search status

- `web_search` and `fetch_url` function tools are now always available regardless of `mimo.webSearch` setting.
- **Pending**: Xiaomi `$web_search` builtin_function plugin — format confirmed (`type: "builtin_function"`, `name: "$web_search"`), API accepts it without error, but MiMo V2 Pro does not invoke it. Awaiting Xiaomi team response on [issue #20](https://github.com/XiaomiMiMo/MiMo-V2-Flash/issues/20).
- DuckDuckGo search works but is subject to rate limiting under heavy use.

## 0.8.0 (2026-04-12)

### Xiaomi $web_search plugin — correct implementation

- **Fixed tool format**: `type: "builtin_function"` with `function.name: "$web_search"` (was incorrectly using `type: "web_search"`).
- **XML response handling**: MiMo returns search requests as XML in `message.content` (not in `tool_calls`). The extension now parses the XML, executes DuckDuckGo search, and injects results back for MiMo to synthesize.
- **Seamless flow**: user asks → MiMo decides to search → returns XML with query/country/freshness → extension searches DuckDuckGo → results sent back → MiMo answers with sources.
- Removed incorrect `webSearchEnabled` parameter.
- DuckDuckGo fallback still available when `mimo.webSearch` is disabled.

## 0.7.7 (2026-04-12)

### Web search fixes

- **`webSearchEnabled: true`** parameter added to request body when using Xiaomi plugin — required by the API.
- **Automatic fallback**: if Xiaomi web search plugin returns an error (400/plugin not enabled), the request is automatically retried with DuckDuckGo local search tools. No more dead-end errors.
- User sees "*Xiaomi web search unavailable — switching to DuckDuckGo...*" when fallback activates.

## 0.7.6 (2026-04-12)

### Persistent tabs

- Tabs now **persist across VS Code restarts**. Open tabs are restored with their full conversation history when you reopen the workspace.
- Each tab stores its history independently via `workspaceState`.
- "Session restored" indicator shown on restored tabs.

### Web search

- **Xiaomi Web Search plugin** (`mimo.webSearch: true`, default): uses the native server-side web search plugin. Requires the plugin to be enabled at platform.xiaomimimo.com.
- **DuckDuckGo fallback** (`mimo.webSearch: false`): two new local function tools — `web_search` (DuckDuckGo Lite/HTML) and `fetch_url` (fetches any public URL as plain text). Free, no API key needed.
- **System prompt hardened**: explicit instructions to never use `curl`/`wget`/`Invoke-WebRequest` for web searches, never invent URLs, and use the provided search tools instead.
- Web search is now **always available** — either via Xiaomi plugin or local fallback. No more dead-end when the model needs online information.

## 0.7.0 (2026-04-12)

### Visible step-by-step feedback

- **Step indicator**: each iteration shows "Step N — calling MiMo..." in real time before and during API calls. The user always knows the agent is alive and what it's doing.
- **Intermediate text**: if MiMo sends text content alongside tool calls (progress updates), it's now displayed immediately instead of being silently stored.
- **Step indicator removed on completion**: cleaned up when the agent finishes.

### Thinking optimization

- Deep thinking (chain-of-thought) now only on **first iteration and checkpoints** (every 10 steps). All other iterations use fast mode — significantly faster execution for multi-step tasks.

### Tab numbering fix

- Counter resets to #1 when all tabs are closed. Continues from last + 1 while tabs remain open.
- Tab providers now receive `extensionContext` for history persistence.

## 0.6.1 (2026-04-11)

- **Usage button fix**: token usage panel now appears at the bottom of chat (was inserted at top, invisible)
- **Clear with confirmation**: "Clear" button asks for confirmation before erasing conversation history
- **New Tab button**: `+ Tab` button in toolbar opens a new independent chat tab without clearing current
- **Tab numbering**: persistent counter via `globalState` — tabs increment correctly across extension reloads

## 0.6.0 (2026-04-11)

### Real-time progress feedback

- **Step counter**: visible "Step N ..." indicator during tool execution — user always knows MiMo is alive
- **Checkpoint summaries**: every 10 iterations (was 20), MiMo summarizes progress. Visible to the user, not just internal.
- **Thinking optimization**: deep reasoning (chain-of-thought) only on first iteration and at checkpoints. Intermediate tool calls use fast mode — dramatically faster execution.
- **JS error boundary**: `window.onerror` handler shows errors visually in the chat panel instead of failing silently.

## 0.5.4 (2026-04-11)

- **M icon**: kept in editor title bar only, removed from status bar
- **Publisher**: changed to `drdelco` to match Open VSX account (eliminates unverified namespace warning)

## 0.5.3 (2026-04-11)

- **Response order fix**: assistant summary now appears AFTER tool activity (was rendering before all tool calls)
- **Timeout**: increased to 300s (was 120s) for thinking-enabled models
- **History bloat**: tool results truncated to 4K chars in conversation history
- **Context compression**: threshold lowered to 25 messages (was 40), keeps last 15 + structured summary

## 0.5.2 (2026-04-11)

- Updated README with all current features (3 models, 9 tools, multi-tab, vision, web search, API key auto-detection)
- Updated CHANGELOG with all versions

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
