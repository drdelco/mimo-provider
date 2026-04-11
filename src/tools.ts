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

/** Web search tool definition sent to MiMo API alongside function tools */
export const WEB_SEARCH_TOOL = {
  type: 'web_search' as const,
  force_search: false,
  max_keyword: 3,
  limit: 5
};

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

      default:
        return `Unknown tool: ${toolCall.function.name}`;
    }
  } catch (error: any) {
    return `Tool error (${toolCall.function.name}): ${error.message}`;
  }
}
