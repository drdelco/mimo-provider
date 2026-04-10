"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOLS = void 0;
exports.executeTool = executeTool;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.TOOLS = [
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a file. Use this to examine code, configuration files, or any text file.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute or relative path to the file' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Create a new file or completely overwrite an existing file with new content.',
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
            description: 'Edit a specific part of an existing file by replacing old content with new content.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path' },
                    old_content: { type: 'string', description: 'Exact content to find and replace' },
                    new_content: { type: 'string', description: 'New content to replace with' }
                },
                required: ['path', 'old_content', 'new_content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'run_terminal',
            description: 'Execute a terminal/shell command. Use for running builds, tests, git commands, installing packages, etc.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Shell command to execute' },
                    cwd: { type: 'string', description: 'Working directory (optional)' }
                },
                required: ['command']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_files',
            description: 'Search for a text pattern across files in the workspace (like grep).',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Text or regex pattern to search for' },
                    path: { type: 'string', description: 'Directory to search in (default: workspace root)' },
                    glob: { type: 'string', description: 'File glob pattern (e.g., "*.ts", "**/*.js")' }
                },
                required: ['pattern']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_files',
            description: 'List files and directories in a given path.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path (default: workspace root)' },
                    recursive: { type: 'boolean', description: 'List recursively (default: false)' }
                },
                required: []
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
                    path: { type: 'string', description: 'File path (optional, returns all if not specified)' }
                },
                required: []
            }
        }
    }
];
function getWorkspaceRoot() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return process.cwd();
    }
    return workspaceFolders[0].uri.fsPath;
}
function resolvePath(filePath) {
    if (path.isAbsolute(filePath))
        return filePath;
    return path.join(getWorkspaceRoot(), filePath);
}
async function executeTool(toolCall) {
    const args = JSON.parse(toolCall.function.arguments);
    try {
        switch (toolCall.function.name) {
            case 'read_file': {
                const fullPath = resolvePath(args.path);
                if (!fs.existsSync(fullPath)) {
                    return `Error: File not found: ${args.path}`;
                }
                const content = fs.readFileSync(fullPath, 'utf-8');
                // Limit output for large files
                if (content.length > 50000) {
                    return content.substring(0, 50000) + '\n\n... (file truncated, showing first 50000 chars)';
                }
                return content;
            }
            case 'write_file': {
                const fullPath = resolvePath(args.path);
                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(fullPath, args.content, 'utf-8');
                return `File written successfully: ${args.path} (${args.content.length} chars)`;
            }
            case 'edit_file': {
                const fullPath = resolvePath(args.path);
                if (!fs.existsSync(fullPath)) {
                    return `Error: File not found: ${args.path}`;
                }
                const content = fs.readFileSync(fullPath, 'utf-8');
                if (!content.includes(args.old_content)) {
                    return `Error: Could not find the specified content in ${args.path}. The file may have changed.`;
                }
                const newContent = content.replace(args.old_content, args.new_content);
                fs.writeFileSync(fullPath, newContent, 'utf-8');
                return `File edited successfully: ${args.path}`;
            }
            case 'run_terminal': {
                const { execSync } = require('child_process');
                const cwd = args.cwd ? resolvePath(args.cwd) : getWorkspaceRoot();
                try {
                    const output = execSync(args.command, {
                        cwd,
                        encoding: 'utf-8',
                        timeout: 30000,
                        maxBuffer: 1024 * 1024,
                        env: { ...process.env }
                    });
                    if (output.length > 10000) {
                        return output.substring(0, 10000) + '\n... (output truncated)';
                    }
                    return output || '(command completed with no output)';
                }
                catch (error) {
                    return `Command failed (exit code ${error.status}):\n${error.stderr || error.message}`;
                }
            }
            case 'search_files': {
                const searchPath = args.path ? resolvePath(args.path) : getWorkspaceRoot();
                const { execSync } = require('child_process');
                try {
                    const grepArgs = args.glob ? `--include="${args.glob}"` : '';
                    const output = execSync(`grep -rn ${grepArgs} "${args.pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null || true`, { encoding: 'utf-8', timeout: 15000, maxBuffer: 1024 * 512 });
                    if (!output.trim()) {
                        return `No matches found for "${args.pattern}"`;
                    }
                    if (output.length > 8000) {
                        return output.substring(0, 8000) + '\n... (results truncated)';
                    }
                    return output;
                }
                catch {
                    return `Search failed for pattern: ${args.pattern}`;
                }
            }
            case 'list_files': {
                const dirPath = args.path ? resolvePath(args.path) : getWorkspaceRoot();
                if (!fs.existsSync(dirPath)) {
                    return `Error: Directory not found: ${args.path || '.'}`;
                }
                const { execSync } = require('child_process');
                const cmd = args.recursive
                    ? `find "${dirPath}" -maxdepth 5 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/out/*' -not -path '*/dist/*' 2>/dev/null | head -200`
                    : `ls -la "${dirPath}" 2>/dev/null`;
                const output = execSync(cmd, { encoding: 'utf-8', timeout: 10000 });
                return output || '(empty directory)';
            }
            case 'get_diagnostics': {
                const allDiagnostics = [];
                const targetUri = args.path ? vscode.Uri.file(resolvePath(args.path)) : undefined;
                if (targetUri) {
                    const diagnostics = vscode.languages.getDiagnostics(targetUri);
                    for (const d of diagnostics) {
                        const severity = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' :
                            d.severity === vscode.DiagnosticSeverity.Warning ? 'WARNING' : 'INFO';
                        allDiagnostics.push(`[${severity}] Line ${d.range.start.line + 1}: ${d.message}`);
                    }
                }
                else {
                    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
                        if (diagnostics.length > 0) {
                            const relPath = vscode.workspace.asRelativePath(uri);
                            for (const d of diagnostics.slice(0, 5)) {
                                const severity = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' :
                                    d.severity === vscode.DiagnosticSeverity.Warning ? 'WARNING' : 'INFO';
                                allDiagnostics.push(`[${severity}] ${relPath}:${d.range.start.line + 1} — ${d.message}`);
                            }
                        }
                    }
                }
                if (allDiagnostics.length === 0) {
                    return 'No diagnostics found. Code looks clean! ✅';
                }
                return allDiagnostics.slice(0, 50).join('\n');
            }
            default:
                return `Unknown tool: ${toolCall.function.name}`;
        }
    }
    catch (error) {
        return `Tool error: ${error.message}`;
    }
}
//# sourceMappingURL=tools.js.map