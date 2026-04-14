import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

// Directories to skip during recursive traversal
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'out', 'dist', '.next', '.nuxt',
  '__pycache__', '.venv', 'venv', 'coverage', '.turbo', '.cache'
]);

// DuckDuckGo rate limiting — 1.2s between requests
let lastDdgTimestamp = 0;
async function ddgDelay(): Promise<void> {
  const elapsed = Date.now() - lastDdgTimestamp;
  if (elapsed < 1200) { await new Promise(r => setTimeout(r, 1200 - elapsed)); }
  lastDdgTimestamp = Date.now();
}

// Stop words for query shortening
const STOP_WORDS = new Set(['how', 'to', 'the', 'a', 'an', 'in', 'for', 'with', 'what', 'is', 'are', 'of', 'on', 'and', 'or', 'de', 'en', 'la', 'el', 'los', 'las', 'un', 'una', 'del', 'al', 'por', 'con', 'que', 'como', 'para', 'sobre']);
function shortenQuery(query: string): string | null {
  const words = query.replace(/["']/g, '').split(/\s+/).filter(w => w.length > 0);
  if (words.length <= 2) return null;
  const meaningful = words.filter(w => !STOP_WORDS.has(w.toLowerCase()));
  const shortened = (meaningful.length >= 2 ? meaningful.slice(0, 3) : words.slice(0, 3)).join(' ');
  return shortened !== query ? shortened : null;
}

export const TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read file contents with line numbers. Use offset/limit to read specific sections of large files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (relative to workspace or absolute)' },
          offset: { type: 'number', description: 'Starting line number (1-based). Omit to start from line 1.' },
          limit: { type: 'number', description: 'Max lines to read. Omit to read entire file (up to 2000 lines).' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create a new file or completely overwrite an existing file. Prefer edit_file for partial changes.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'Complete file content' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace specific content in a file. old_content must be unique unless replace_all is true. Always read_file first.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          old_content: { type: 'string', description: 'Exact text to find (must be unique in file unless replace_all)' },
          new_content: { type: 'string', description: 'Replacement text' },
          replace_all: { type: 'boolean', description: 'Replace ALL occurrences instead of just the first (default: false)' }
        },
        required: ['path', 'old_content', 'new_content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_terminal',
      description: 'Execute a shell command asynchronously. Default timeout 120s, max 300s. Does not block the IDE.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          cwd: { type: 'string', description: 'Working directory (optional, defaults to workspace root)' },
          timeout: { type: 'number', description: 'Timeout in seconds (default: 120, max: 300)' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for a text or regex pattern across files. Cross-platform. Supports context lines and glob filtering.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Text or regex pattern to search for' },
          path: { type: 'string', description: 'Directory to search in (default: workspace root)' },
          glob: { type: 'string', description: 'File extension filter (e.g. "*.ts", "*.py")' },
          context_lines: { type: 'number', description: 'Lines of context before/after each match (default: 0)' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories. Cross-platform. Supports recursive listing and glob filtering.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path (default: workspace root)' },
          recursive: { type: 'boolean', description: 'List recursively (default: false)' },
          glob: { type: 'string', description: 'Filter files by pattern (e.g. "*.ts")' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_files',
      description: 'Find files matching a glob pattern across the entire workspace. Uses VS Code file indexing — fast even on large repos.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.tsx", "src/**/*.test.ts")' },
          max_results: { type: 'number', description: 'Maximum results to return (default: 100)' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_diagnostics',
      description: 'Get errors and warnings from the VS Code Problems panel for a file or all files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (optional — returns all diagnostics if omitted)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_image',
      description: 'Read an image file and describe it using the multimodal MiMo V2 Omni model. Use for screenshots, diagrams, UI mockups, etc.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to image file (PNG, JPG, GIF, WebP, BMP)' },
          question: { type: 'string', description: 'What to analyze in the image (default: "Describe this image in detail")' }
        },
        required: ['path']
      }
    }
  }
];

/** Xiaomi native web search plugin — builtin_function format (like Kimi/Moonshot) */
export const WEB_SEARCH_TOOL = {
  type: 'builtin_function' as const,
  function: { name: '$web_search' }
};

/** Local web search tools — used as fallback when Xiaomi plugin is not enabled */
export const LOCAL_WEB_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web using DuckDuckGo. Returns titles, URLs, and snippets. Use for current events, documentation, legal references, or any external information.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          max_results: { type: 'number', description: 'Max results to return (default: 8, max: 15)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch a web page and extract its text content. Use to read documentation, articles, or any public URL. Do NOT use for search engines — use web_search instead.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to fetch (https://)' },
          max_chars: { type: 'number', description: 'Max characters to return (default: 12000)' }
        },
        required: ['url']
      }
    }
  }
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWorkspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
}

function resolvePath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(getWorkspaceRoot(), filePath);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** Simple glob matching: *.ts, *.{ts,tsx}, etc. */
function matchGlob(filename: string, pattern: string): boolean {
  // Handle {a,b} alternatives
  if (pattern.includes('{')) {
    const match = pattern.match(/\{([^}]+)\}/);
    if (match) {
      const alternatives = match[1].split(',');
      return alternatives.some(alt =>
        matchGlob(filename, pattern.replace(match[0], alt.trim()))
      );
    }
  }
  const regex = new RegExp(
    '^' + pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '<<<GLOBSTAR>>>')
      .replace(/\*/g, '[^/\\\\]*')
      .replace(/\?/g, '[^/\\\\]')
      .replace(/<<<GLOBSTAR>>>/g, '.*')
    + '$'
  );
  return regex.test(filename);
}

/** Recursive directory walker with skip list */
function walkDir(dir: string, maxDepth: number, depth = 0): string[] {
  if (depth > maxDepth) return [];
  const files: string[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return files; }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(full, maxDepth, depth + 1));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

// Patterns that are catastrophically destructive — refuse outright
const CATASTROPHIC = [
  /rm\s+-r[f ].*\s+\/\s*$/,
  /rm\s+-fr\s+\/\s*$/,
  /format\s+[a-z]:\s*$/i,
  /del\s+\/[sf].*\s+[a-z]:\\\s*$/i,
  /mkfs\./,
  /dd\s+.*of=\/dev\/sd/,
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

export async function executeTool(toolCall: ToolCall): Promise<string> {
  const args = JSON.parse(toolCall.function.arguments);

  try {
    switch (toolCall.function.name) {

      // ===== READ FILE =====
      case 'read_file': {
        const fullPath = resolvePath(args.path);
        if (!fs.existsSync(fullPath)) {
          return `Error: File not found: ${args.path}`;
        }
        const stat = fs.statSync(fullPath);
        if (stat.size > 2 * 1024 * 1024) {
          return `Error: File too large (${formatSize(stat.size)}). Use offset/limit to read sections.`;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        const allLines = content.split('\n');
        const totalLines = allLines.length;

        const start = Math.max(0, (args.offset || 1) - 1);
        const defaultLimit = args.offset ? (args.limit || 200) : Math.min(totalLines, 2000);
        const count = args.limit || defaultLimit;
        const end = Math.min(totalLines, start + count);
        const lines = allLines.slice(start, end);

        const maxWidth = String(end).length;
        const numbered = lines.map((line, i) => {
          const lineNum = String(start + i + 1).padStart(maxWidth);
          return `${lineNum}\t${line}`;
        }).join('\n');

        if (end < totalLines) {
          return numbered + `\n\n(Lines ${start + 1}-${end} of ${totalLines}. Use offset/limit for more.)`;
        }
        return numbered;
      }

      // ===== WRITE FILE =====
      case 'write_file': {
        const fullPath = resolvePath(args.path);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, args.content, 'utf-8');
        const lines = args.content.split('\n').length;
        return `File written: ${args.path} (${lines} lines, ${args.content.length} chars)`;
      }

      // ===== EDIT FILE =====
      case 'edit_file': {
        const fullPath = resolvePath(args.path);
        if (!fs.existsSync(fullPath)) {
          return `Error: File not found: ${args.path}`;
        }
        const content = fs.readFileSync(fullPath, 'utf-8');

        if (!content.includes(args.old_content)) {
          // Help the model understand why it failed
          const lines = content.split('\n');
          const firstWords = args.old_content.split('\n')[0].trim().substring(0, 40);
          const candidates = lines
            .map((l, i) => ({ line: i + 1, text: l }))
            .filter(l => l.text.includes(firstWords.substring(0, 15)))
            .slice(0, 3);

          let hint = `Error: old_content not found in ${args.path}. Read the file first to get the exact content.`;
          if (candidates.length > 0) {
            hint += `\nPossible near-matches at lines: ${candidates.map(c => c.line).join(', ')}`;
          }
          return hint;
        }

        // Count occurrences
        const occurrences = content.split(args.old_content).length - 1;

        if (!args.replace_all && occurrences > 1) {
          return `Error: Found ${occurrences} occurrences of old_content in ${args.path}. Include more surrounding context to make it unique, or set replace_all: true.`;
        }

        let newContent: string;
        if (args.replace_all) {
          newContent = content.split(args.old_content).join(args.new_content);
        } else {
          newContent = content.replace(args.old_content, args.new_content);
        }

        fs.writeFileSync(fullPath, newContent, 'utf-8');
        const count = args.replace_all ? occurrences : 1;
        return `File edited: ${args.path} (${count} replacement${count > 1 ? 's' : ''})`;
      }

      // ===== RUN TERMINAL (async) =====
      case 'run_terminal': {
        const { exec } = require('child_process') as typeof import('child_process');
        const cwd = args.cwd ? resolvePath(args.cwd) : getWorkspaceRoot();
        const timeoutSec = Math.min(args.timeout || 120, 300);
        const timeoutMs = timeoutSec * 1000;

        // Refuse catastrophic commands
        const cmdLower = args.command.trim();
        if (CATASTROPHIC.some(re => re.test(cmdLower))) {
          return `REFUSED: This command looks catastrophically destructive. Use explicit paths, not root-level wildcards.`;
        }

        return new Promise<string>((resolve) => {
          exec(args.command, {
            cwd,
            encoding: 'utf-8',
            timeout: timeoutMs,
            maxBuffer: 5 * 1024 * 1024,
            env: { ...process.env }
          }, (error: any, stdout: string, stderr: string) => {
            let result: string;

            if (error?.killed) {
              result = `Command timed out after ${timeoutSec}s. Use a longer timeout if needed.`;
            } else if (error) {
              result = `Exit code ${error.code ?? 1}:\n${stderr || error.message}`;
              if (stdout) result += `\n\nStdout:\n${stdout}`;
            } else {
              result = stdout || '(no output)';
              if (stderr) result += `\n\nStderr:\n${stderr}`;
            }

            if (result.length > 20000) {
              result = result.substring(0, 20000) + '\n... (truncated at 20K chars)';
            }
            resolve(result);
          });
        });
      }

      // ===== SEARCH FILES (cross-platform, pure Node.js) =====
      case 'search_files': {
        const searchDir = args.path ? resolvePath(args.path) : getWorkspaceRoot();
        if (!fs.existsSync(searchDir)) {
          return `Error: Directory not found: ${args.path || '.'}`;
        }

        let regex: RegExp;
        try {
          regex = new RegExp(args.pattern, 'i');
        } catch {
          // Fall back to literal search if invalid regex
          regex = new RegExp(args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        }

        const ctxLines = args.context_lines || 0;
        const results: string[] = [];
        const maxResults = 200;
        let totalChars = 0;
        const maxChars = 20000;

        const allFiles = walkDir(searchDir, 10);

        for (const filePath of allFiles) {
          if (results.length >= maxResults || totalChars >= maxChars) break;

          // Apply glob filter on filename
          if (args.glob && !matchGlob(path.basename(filePath), args.glob)) continue;

          let content: string;
          try {
            const stat = fs.statSync(filePath);
            if (stat.size > 500000) continue; // Skip files > 500KB
            content = fs.readFileSync(filePath, 'utf-8');
          } catch { continue; }

          // Skip likely binary files
          if (content.includes('\0')) continue;

          const lines = content.split('\n');
          const relPath = path.relative(searchDir, filePath).replace(/\\/g, '/');

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults || totalChars >= maxChars) break;

            if (regex.test(lines[i])) {
              if (ctxLines > 0) {
                const start = Math.max(0, i - ctxLines);
                const end = Math.min(lines.length, i + ctxLines + 1);
                for (let j = start; j < end; j++) {
                  const prefix = j === i ? '>' : ' ';
                  const line = `${prefix} ${relPath}:${j + 1}: ${lines[j]}`;
                  results.push(line);
                  totalChars += line.length;
                }
                results.push('---');
              } else {
                const line = `${relPath}:${i + 1}: ${lines[i]}`;
                results.push(line);
                totalChars += line.length;
              }
            }
          }
        }

        if (results.length === 0) {
          return `No matches found for "${args.pattern}"`;
        }
        let output = results.join('\n');
        if (results.length >= maxResults) {
          output += `\n\n(Limited to ${maxResults} matches. Narrow your search with glob or path.)`;
        }
        return output;
      }

      // ===== LIST FILES (cross-platform, pure Node.js) =====
      case 'list_files': {
        const dirPath = args.path ? resolvePath(args.path) : getWorkspaceRoot();
        if (!fs.existsSync(dirPath)) {
          return `Error: Directory not found: ${args.path || '.'}`;
        }

        const entries: string[] = [];
        const maxEntries = 500;

        function listDir(dir: string, depth: number, prefix: string) {
          if (entries.length >= maxEntries) return;
          let items: fs.Dirent[];
          try { items = fs.readdirSync(dir, { withFileTypes: true }); }
          catch { return; }

          items.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
          });

          for (const item of items) {
            if (entries.length >= maxEntries) break;
            const isDir = item.isDirectory();
            if (isDir && SKIP_DIRS.has(item.name)) continue;
            if (!isDir && args.glob && !matchGlob(item.name, args.glob)) continue;

            const full = path.join(dir, item.name);
            try {
              const stat = fs.statSync(full);
              const size = isDir ? '' : ` (${formatSize(stat.size)})`;
              const marker = isDir ? '/' : '';
              entries.push(`${prefix}${item.name}${marker}${size}`);
            } catch {
              entries.push(`${prefix}${item.name} (unreadable)`);
            }

            if (isDir && args.recursive) {
              listDir(full, depth + 1, prefix + '  ');
            }
          }
        }

        listDir(dirPath, 0, '');

        if (entries.length === 0) return '(empty directory)';
        let result = entries.join('\n');
        if (entries.length >= maxEntries) {
          result += `\n\n(Limited to ${maxEntries} entries. Use glob or a deeper path.)`;
        }
        return result;
      }

      // ===== FIND FILES (VS Code glob API) =====
      case 'find_files': {
        const maxResults = args.max_results || 100;
        try {
          const files = await vscode.workspace.findFiles(
            args.pattern,
            '**/node_modules/**',
            maxResults
          );
          if (files.length === 0) {
            return `No files matching "${args.pattern}"`;
          }
          return files
            .map(f => vscode.workspace.asRelativePath(f))
            .sort()
            .join('\n');
        } catch (err: any) {
          return `Error finding files: ${err.message}`;
        }
      }

      // ===== GET DIAGNOSTICS =====
      case 'get_diagnostics': {
        const allDiagnostics: string[] = [];
        const targetUri = args.path ? vscode.Uri.file(resolvePath(args.path)) : undefined;

        if (targetUri) {
          const diagnostics = vscode.languages.getDiagnostics(targetUri);
          for (const d of diagnostics) {
            const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR'
              : d.severity === vscode.DiagnosticSeverity.Warning ? 'WARN' : 'INFO';
            allDiagnostics.push(`[${sev}] Line ${d.range.start.line + 1}: ${d.message}`);
          }
        } else {
          for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
            if (diagnostics.length === 0) continue;
            const relPath = vscode.workspace.asRelativePath(uri);
            for (const d of diagnostics.slice(0, 10)) {
              const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR'
                : d.severity === vscode.DiagnosticSeverity.Warning ? 'WARN' : 'INFO';
              allDiagnostics.push(`[${sev}] ${relPath}:${d.range.start.line + 1}: ${d.message}`);
            }
          }
        }

        if (allDiagnostics.length === 0) {
          return 'No diagnostics. Code looks clean.';
        }
        return allDiagnostics.slice(0, 80).join('\n');
      }

      // ===== READ IMAGE (uses Omni model) =====
      case 'read_image': {
        const fullPath = resolvePath(args.path);
        if (!fs.existsSync(fullPath)) {
          return `Error: Image not found: ${args.path}`;
        }
        const stat = fs.statSync(fullPath);
        if (stat.size > 10 * 1024 * 1024) {
          return `Error: Image too large (${formatSize(stat.size)}). Max 10MB.`;
        }
        const ext = path.extname(fullPath).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp'
        };
        const mime = mimeMap[ext];
        if (!mime) {
          return `Error: Unsupported image format: ${ext}. Supported: PNG, JPG, GIF, WebP, BMP.`;
        }

        // Encode to base64 and call Omni model
        const imageData = fs.readFileSync(fullPath);
        const base64 = imageData.toString('base64');
        const dataUri = `data:${mime};base64,${base64}`;
        const question = args.question || 'Describe this image in detail. If it contains code, UI, or text, transcribe the relevant parts.';

        const config = vscode.workspace.getConfiguration('mimo');
        const apiKey = config.inspect<string>('apiKey')?.workspaceValue
          || config.inspect<string>('apiKey')?.globalValue || '';
        const baseUrl = config.inspect<string>('baseUrl')?.workspaceValue
          || config.inspect<string>('baseUrl')?.globalValue || 'https://token-plan-ams.xiaomimimo.com/v1';

        if (!apiKey) return 'Error: API key not configured. Cannot analyze image.';

        try {
          const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: 'mimo-v2-omni',
              messages: [{
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: dataUri } },
                  { type: 'text', text: question }
                ]
              }],
              max_completion_tokens: 4096,
              stream: false
            }),
            signal: AbortSignal.timeout(60000)
          });

          if (!response.ok) {
            const errText = await response.text();
            return `Error calling Omni model: ${response.status} ${errText}`;
          }

          const data = await response.json() as any;
          return data.choices?.[0]?.message?.content || 'No description returned.';
        } catch (err: any) {
          return `Error analyzing image: ${err.message}`;
        }
      }

      // ===== WEB SEARCH (DuckDuckGo with delay + retry) =====
      case 'web_search': {
        const query = args.query;
        const maxResults = Math.min(args.max_results || 8, 15);
        if (!query) return 'Error: query is required';

        const formatResults = (results: SearchResult[]) =>
          results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');

        async function ddgSearch(q: string, max: number): Promise<SearchResult[]> {
          await ddgDelay();
          try {
            const params = new URLSearchParams({ q, kl: '' });
            const resp = await fetch('https://lite.duckduckgo.com/lite/', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              },
              body: params.toString(),
              signal: AbortSignal.timeout(15000)
            });
            if (resp.ok) {
              const results = parseDuckDuckGoLite(await resp.text(), max);
              if (results.length > 0) return results;
            }
          } catch { /* fall through to HTML variant */ }

          await ddgDelay();
          try {
            const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
              signal: AbortSignal.timeout(15000)
            });
            if (resp.ok) return parseDuckDuckGoHtml(await resp.text(), max);
          } catch { /* no results */ }
          return [];
        }

        try {
          let results = await ddgSearch(query, maxResults);
          if (results.length > 0) return formatResults(results);

          // Auto-retry with shorter query
          const shorter = shortenQuery(query);
          if (shorter) {
            results = await ddgSearch(shorter, maxResults);
            if (results.length > 0) return `(Retried with: "${shorter}")\n\n` + formatResults(results);
          }

          return `No results found for: ${query}${shorter ? ` (also tried: "${shorter}")` : ''}`;
        } catch (err: any) {
          return `Web search failed: ${err.message}`;
        }
      }

      // ===== FETCH URL =====
      case 'fetch_url': {
        const url = args.url;
        const maxChars = Math.min(args.max_chars || 12000, 30000);
        if (!url) return 'Error: url is required';
        if (!url.startsWith('http')) return 'Error: url must start with http:// or https://';

        try {
          const resp = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'es,en;q=0.9'
            },
            signal: AbortSignal.timeout(20000),
            redirect: 'follow'
          });

          if (!resp.ok) return `Fetch failed: HTTP ${resp.status} ${resp.statusText}`;

          const contentType = resp.headers.get('content-type') || '';
          const text = await resp.text();

          if (contentType.includes('application/json')) {
            return text.substring(0, maxChars);
          }

          // Strip HTML to plain text
          const clean = htmlToText(text);
          if (clean.length === 0) return 'Page returned no readable text content.';
          if (clean.length > maxChars) {
            return clean.substring(0, maxChars) + '\n\n... (truncated)';
          }
          return clean;
        } catch (err: any) {
          return `Fetch failed: ${err.message}`;
        }
      }

      default:
        return `Unknown tool: ${toolCall.function.name}`;
    }
  } catch (error: any) {
    return `Tool error (${toolCall.function.name}): ${error.message}`;
  }
}

// ---------------------------------------------------------------------------
// Xiaomi $web_search XML handling
// ---------------------------------------------------------------------------

/**
 * Check if MiMo's response content contains a $web_search XML call.
 * MiMo returns search requests as XML in message.content (NOT in tool_calls).
 */
export function containsWebSearchXml(content: string): boolean {
  return content.includes('$web_search') && content.includes('<');
}

/**
 * Parse MiMo's $web_search XML and extract search parameters.
 * MiMo returns XML like: <$web_search> <query>search terms</query> <country>ES</country> <freshness>day</freshness> </$web_search>
 */
function parseWebSearchXml(content: string): { query: string; country?: string; freshness?: string } | null {
  // Extract content between web_search tags (handles $web_search or web_search)
  const blockMatch = content.match(/<\$?web_search[^>]*>([\s\S]*?)<\/\$?web_search>/i);
  if (!blockMatch) return null;

  const block = blockMatch[1];
  const queryMatch = block.match(/<query>([\s\S]*?)<\/query>/i);
  if (!queryMatch) return null;

  const countryMatch = block.match(/<country>([\s\S]*?)<\/country>/i);
  const freshnessMatch = block.match(/<freshness>([\s\S]*?)<\/freshness>/i);

  return {
    query: queryMatch[1].trim(),
    country: countryMatch?.[1]?.trim(),
    freshness: freshnessMatch?.[1]?.trim()
  };
}

/**
 * Handle MiMo's $web_search XML: parse it, execute DuckDuckGo search, return formatted results.
 */
export async function executeWebSearchFromXml(content: string): Promise<{ query: string; results: string } | null> {
  const params = parseWebSearchXml(content);
  if (!params) return null;

  // Execute DuckDuckGo search using our existing infrastructure
  try {
    const searchParams = new URLSearchParams({ q: params.query, kl: params.country || '' });
    const resp = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: searchParams.toString(),
      signal: AbortSignal.timeout(15000)
    });

    let results: SearchResult[] = [];
    if (resp.ok) {
      const html = await resp.text();
      results = parseDuckDuckGoLite(html, 8);
    }

    // Fallback to DDG HTML
    if (results.length === 0) {
      const resp2 = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(15000)
      });
      if (resp2.ok) {
        const html2 = await resp2.text();
        results = parseDuckDuckGoHtml(html2, 8);
      }
    }

    const formatted = results.length > 0
      ? results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n')
      : `No results found for: ${params.query}`;

    return { query: params.query, results: formatted };
  } catch (err: any) {
    return { query: params.query, results: `Search failed: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Web search helpers
// ---------------------------------------------------------------------------

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Parse DuckDuckGo Lite HTML results */
function parseDuckDuckGoLite(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo Lite uses table rows: link in <a class="result-link">, snippet in <td class="result-snippet">
  // Pattern: find all result links and their associated snippets
  const linkRegex = /<a[^>]+class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

  const links: { url: string; title: string }[] = [];
  let m;
  while ((m = linkRegex.exec(html)) !== null && links.length < max) {
    links.push({ url: stripTags(m[1]).trim(), title: stripTags(m[2]).trim() });
  }

  const snippets: string[] = [];
  while ((m = snippetRegex.exec(html)) !== null && snippets.length < max) {
    snippets.push(stripTags(m[1]).trim());
  }

  // If structured parsing didn't work, try a more generic approach
  if (links.length === 0) {
    // Generic: find all <a> with http hrefs that look like results
    const genericLink = /<a[^>]+href="(https?:\/\/(?!lite\.duckduckgo|duckduckgo)[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const seen = new Set<string>();
    while ((m = genericLink.exec(html)) !== null && links.length < max) {
      const url = m[1];
      const title = stripTags(m[2]).trim();
      if (title.length > 3 && !seen.has(url) && !url.includes('duckduckgo.com')) {
        seen.add(url);
        links.push({ url, title });
      }
    }
  }

  for (let i = 0; i < links.length; i++) {
    results.push({
      title: links[i].title || '(no title)',
      url: links[i].url,
      snippet: snippets[i] || ''
    });
  }

  return results;
}

/** Parse DuckDuckGo HTML (full version) results */
function parseDuckDuckGoHtml(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo HTML uses <a class="result__a"> for links and <a class="result__snippet"> for snippets
  const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const links: { url: string; title: string }[] = [];
  let m;
  while ((m = resultRegex.exec(html)) !== null && links.length < max) {
    let url = stripTags(m[1]).trim();
    // DDG wraps URLs through a redirect — extract the real URL
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    links.push({ url, title: stripTags(m[2]).trim() });
  }

  const snippets: string[] = [];
  while ((m = snippetRegex.exec(html)) !== null && snippets.length < max) {
    snippets.push(stripTags(m[1]).trim());
  }

  for (let i = 0; i < links.length; i++) {
    results.push({
      title: links[i].title || '(no title)',
      url: links[i].url,
      snippet: snippets[i] || ''
    });
  }

  return results;
}

/** Strip HTML tags from a string */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Convert HTML to readable plain text — aggressive noise removal */
function htmlToText(html: string): string {
  let text = html;

  // Remove non-content blocks entirely
  const removeBlocks = [
    /<script[\s\S]*?<\/script>/gi,
    /<style[\s\S]*?<\/style>/gi,
    /<nav[\s\S]*?<\/nav>/gi,
    /<header[\s\S]*?<\/header>/gi,
    /<footer[\s\S]*?<\/footer>/gi,
    /<aside[\s\S]*?<\/aside>/gi,
    /<form[\s\S]*?<\/form>/gi,
    /<iframe[\s\S]*?<\/iframe>/gi,
    /<noscript[\s\S]*?<\/noscript>/gi,
    /<svg[\s\S]*?<\/svg>/gi,
    /<button[\s\S]*?<\/button>/gi,
    /<select[\s\S]*?<\/select>/gi,
    /<input[^>]*>/gi,
    /<label[\s\S]*?<\/label>/gi,
    /<!--[\s\S]*?-->/g,
  ];
  for (const rx of removeBlocks) { text = text.replace(rx, ''); }

  // Remove elements by common noise class/id patterns (menus, sidebars, cookies, ads)
  text = text.replace(/<[^>]+(class|id)="[^"]*(?:menu|sidebar|cookie|consent|popup|modal|banner|advert|social|share|related|comment|breadcrumb|pagination|newsletter|subscribe|signup|login|search-form|filter)[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, '');

  // Convert headings to markdown-style for readability
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  text = text.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n#### $1\n');

  // Convert list items
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');

  // Convert links to [text](url) — preserve useful URLs
  text = text.replace(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, url, label) => {
    const cleanLabel = label.replace(/<[^>]+>/g, '').trim();
    return cleanLabel ? `[${cleanLabel}](${url})` : '';
  });

  // Block elements → newlines
  text = text.replace(/<\/?(p|div|br|tr|blockquote|section|article|main|figcaption|details|summary)[^>]*>/gi, '\n');

  // Strip all remaining tags
  text = stripTags(text);

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, ' ');           // collapse horizontal space
  text = text.replace(/ *\n */g, '\n');           // trim lines
  text = text.replace(/\n{3,}/g, '\n\n');         // max 2 consecutive newlines
  text = text.split('\n')                         // remove very short noise lines
    .filter(line => line.trim().length > 2 || line.trim() === '')
    .join('\n');
  text = text.trim();

  return text;
}
