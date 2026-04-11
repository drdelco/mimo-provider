import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Prompt cache — avoids rebuilding and re-reading files every iteration
// ---------------------------------------------------------------------------

let cachedPrompt: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60_000; // 60 seconds

export function invalidatePromptCache() {
  cachedPrompt = null;
}

export function buildSystemPrompt(forceRefresh = false): string {
  const now = Date.now();
  if (!forceRefresh && cachedPrompt && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedPrompt;
  }

  const root = getWorkspaceRoot();
  const name = vscode.workspace.workspaceFolders?.[0]?.name || path.basename(root);
  const shell = getShellInfo();
  const git = getGitInfo(root);
  const context = loadContextFiles(root);

  const prompt = `You are MiMo, an AI coding assistant by Xiaomi, running inside Antigravity IDE.

## Tools
- \`read_file\` — Read with line numbers. Params: path, offset (line), limit (lines).
- \`write_file\` — Create or overwrite. Only for new files or full rewrites.
- \`edit_file\` — Surgical replacement. old_content must be unique (or set replace_all: true). Always read_file first.
- \`run_terminal\` — Async shell command. Params: command, cwd, timeout (default 120s, max 300s).
- \`search_files\` — Regex search across files. Params: pattern, path, glob, context_lines.
- \`list_files\` — Directory listing. Params: path, recursive, glob.
- \`find_files\` — Fast glob search across workspace. Params: pattern (e.g. "**/*.ts"), max_results.
- \`get_diagnostics\` — VS Code errors/warnings. Params: path (optional).
- \`read_image\` — Analyze an image using MiMo V2 Omni (vision). Params: path, question. Use for screenshots, UI mockups, diagrams.

## Web Search
You have web search capability. Use it for current events, documentation, legal references, or any external information.
- \`web_search\` — Search the web with a query. Returns titles, URLs, and snippets.
- \`fetch_url\` — Fetch and read a specific web page as plain text.
- NEVER use \`run_terminal\` with curl, wget, or Invoke-WebRequest to search the web. Use the search tools above.
- NEVER fabricate or guess URLs. Search first, then fetch URLs from the results.
- NEVER attempt to scrape Google, DuckDuckGo, or any search engine via terminal commands.
- If web search results are insufficient, say so — do not make up information.

## Environment
- OS: ${shell}
- Workspace: \`${name}\` at \`${root}\`
${git}
## Workflow
1. Explore first — use \`find_files\`, \`list_files\`, \`search_files\` before changes.
2. Always \`read_file\` before \`edit_file\`. Use offset/limit for large files.
3. Prefer \`edit_file\` for changes. \`write_file\` only for new files or full rewrites.
4. After edits, run \`get_diagnostics\` to verify no errors were introduced.
5. Test with \`run_terminal\` when appropriate (builds, tests, linters).
6. IMPORTANT: Put your final summary AFTER all tool work is complete. Do NOT lead with "Done!" or a summary — the user sees tool activity in real time, so your final message should be a concise wrap-up at the end, not a preamble.

## Rules
- NEVER guess file paths — use \`find_files\` or \`search_files\` first.
- If edit_file fails ("not found" or "not unique"), re-read the file and retry with exact content.
- If a command fails, diagnose before retrying. Check exit code and stderr.
- For large tasks, break into phases and report progress at each phase.
- Be concise. Give brief progress updates between tool calls.
- Match the user's language in your responses.
- NEVER invent URLs. Do not guess documentation links, blog posts, or API endpoints. If you need web info, let the web search plugin handle it.

## Context Memory
Maintain \`.mimo-context.md\` in the project root as persistent memory across sessions:
- At task start: if it exists, read it before exploring the codebase.
- While working: update it with architecture, key files, task progress, and notes.
${context}`;

  cachedPrompt = prompt;
  cacheTimestamp = now;
  return prompt;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWorkspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
}

function getShellInfo(): string {
  if (process.platform === 'win32') {
    return 'Windows. Use CMD: dir, type, findstr, copy, del, cd /d. PowerShell: Get-ChildItem, Get-Content.';
  }
  if (process.platform === 'darwin') {
    return 'macOS. Use Unix: ls, cat, grep, cp, rm, cd.';
  }
  return 'Linux. Use Unix: ls, cat, grep, cp, rm, cd.';
}

function getGitInfo(root: string): string {
  try {
    const { execSync } = require('child_process') as typeof import('child_process');
    const opts = { cwd: root, encoding: 'utf-8' as const, timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] as any };

    // Check if git repo
    try { execSync('git rev-parse --git-dir', opts); }
    catch { return ''; }

    let branch = '';
    try { branch = execSync('git branch --show-current', opts).trim(); } catch {}

    let user = '';
    try { user = execSync('git config user.name', opts).trim(); } catch {}

    let statusLines: string[] = [];
    try {
      const status = execSync('git status --short', opts).trim();
      if (status) statusLines = status.split('\n').slice(0, 15);
    } catch {}

    let recentCommits = '';
    try {
      recentCommits = execSync('git log --oneline -5', opts).trim();
    } catch {}

    const parts: string[] = ['## Git'];
    if (branch) parts.push(`- Branch: \`${branch}\``);
    if (user) parts.push(`- User: ${user}`);
    if (statusLines.length > 0) {
      parts.push(`- Changed files:\n${statusLines.map(l => '  ' + l).join('\n')}`);
    } else {
      parts.push('- Working tree clean');
    }
    if (recentCommits) {
      parts.push(`- Recent commits:\n${recentCommits.split('\n').map(l => '  ' + l).join('\n')}`);
    }

    return parts.join('\n') + '\n';
  } catch {
    return '';
  }
}

function loadContextFiles(root: string): string {
  const filesToCheck = [
    'CLAUDE.md',
    '.mimo-context.md',
    '.cursorrules',
    'AGENTS.md',
    '.agent/AGENTS.md',
    '.github/copilot-instructions.md'
  ];

  const sections: string[] = [];

  for (const file of filesToCheck) {
    const fullPath = path.join(root, file);
    try {
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8').substring(0, 10000);
        sections.push(`### ${file}\n\`\`\`\n${content}\n\`\`\``);
      }
    } catch { /* skip unreadable */ }
  }

  // .claude/rules/*.md
  const rulesDir = path.join(root, '.claude', 'rules');
  try {
    if (fs.existsSync(rulesDir)) {
      for (const rf of fs.readdirSync(rulesDir).filter(f => f.endsWith('.md'))) {
        const content = fs.readFileSync(path.join(rulesDir, rf), 'utf-8').substring(0, 5000);
        sections.push(`### .claude/rules/${rf}\n\`\`\`\n${content}\n\`\`\``);
      }
    }
  } catch { /* skip */ }

  if (sections.length === 0) return '';
  return `\n## Project Context (auto-loaded)\n${sections.join('\n\n')}`;
}
