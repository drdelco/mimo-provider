# Changelog

## 0.1.0 (2026-04-10)

### Initial release

**Models:**
- MiMo V2 Pro — advanced reasoning model
- MiMo V2 Flash — fast response model

**Chat Panel:**
- Dedicated sidebar with chat interface (Activity Bar icon)
- Full conversation history with context
- Quick action buttons (Explain, Refactor, Debug, Test)
- Markdown rendering with code highlighting
- "Insert into editor" for generated code
- New chat / clear history

**Coding Agent (Tool Calling):**
- `read_file` — read file contents
- `write_file` — create/overwrite files
- `edit_file` — surgical edits to existing files
- `run_terminal` — execute shell commands
- `search_files` — grep search across codebase
- `list_files` — list directory contents
- `get_diagnostics` — read VS Code errors/warnings

**Integration:**
- VS Code Language Model Chat Provider (model picker)
- Chat Participant (`@MiMo` in native chat)
- API key management (synced User + Workspace)
- Connection test command
- Custom icon (M in gray, works light/dark)

### Enhanced (same day)

**Chat UX:**
- Enter to send, Shift+Enter for new line
- 📎 Attach files as context — read and injected into conversation
- 📊 Token usage tracker with link to MiMo Platform quota
- ⏹ Stop button — appears during processing, aborts immediately
- Live message injection — send messages while MiMo is working, incorporated mid-task
- Sober styling consistent with Antigravity/VS Code themes

**Agent Intelligence:**
- 500 iteration safety cap (up from 15)
- Progress checkpoint every 20 iterations — MiMo summarizes status
- Shell detection — auto-detects Windows (CMD/PowerShell) vs Unix (bash)
- Progress feedback — MiMo explains each step as it works

**Context Memory:**
- Reads existing context files at session start: CLAUDE.md, .claude/rules/, .agent/, AGENTS.md, .cursorrules, etc.
- Maintains `.mimo-context.md` as persistent project memory across sessions
- Updates context file during checkpoints and when discovering important info

**Icons:**
- Official Xiaomi MiMo logo for marketplace icon
- Official "M" letter for Activity Bar, Editor Title Bar, and Status Bar
- Custom icon font (`contributes.icons`) for VS Code integration
