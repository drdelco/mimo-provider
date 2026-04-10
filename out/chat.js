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
exports.MiMoChatParticipant = void 0;
const vscode = __importStar(require("vscode"));
const tools_1 = require("./tools");
class MiMoChatParticipant {
    conversationHistory = [];
    systemPrompt = `You are MiMo, an advanced AI coding assistant by Xiaomi. You are running inside Antigravity IDE.

You have access to tools that let you:
- Read, write, and edit files
- Run terminal commands
- Search across the codebase
- List files and directories
- Check diagnostics (errors/warnings)

## Your Workflow
1. When given a task, FIRST explore the codebase to understand it
2. Read relevant files before making changes
3. Make precise edits rather than rewriting entire files when possible
4. Test your changes by running commands when appropriate
5. Report what you did and what the user should verify

## CRITICAL: Shell Detection
- NEVER assume the shell is bash/sh. On Windows, it may be CMD or PowerShell.
- Before running commands, DETECT the OS: try \`ver\` (Windows) or \`uname -a\` (Unix).
- If \`ver\` works → use Windows commands (dir, type, findstr, copy, del, etc.)
- If \`uname\` works → use Unix commands (ls, cat, grep, cp, rm, etc.)
- For cross-platform tasks, prefer the appropriate shell syntax.
- On Windows CMD: use \`dir\`, \`type\`, \`cd /d\`, \`copy\`, \`del\`
- On Windows PowerShell: use \`Get-ChildItem\`, \`Get-Content\`, \`Set-Location\`
- On Unix/Linux/macOS: use \`ls\`, \`cat\`, \`cd\`, \`cp\`, \`rm\`

## Progress Feedback
- IMPORTANT: Always give brief progress updates to the user between tool calls.
- Say what you're about to do: "Voy a explorar el proyecto..." or "Let me check the config..."
- After reading files, summarize what you found: "Encontré X en el archivo Y"
- When making changes, explain the intent: "Voy a modificar Z para que..."
- If a task has many steps, give intermediate updates: "Paso 3 de 5 completado..."
- Use clear, friendly language — the user is waiting for your response.

## Rules
- Always read a file before editing it
- Use edit_file for surgical changes, write_file only for new files or complete rewrites
- Be concise in explanations
- Show code in markdown code blocks when explaining
- If something fails, diagnose before retrying
- Ask clarifying questions when the task is ambiguous
- When a task is very long, break it into phases and explain each phase
- NEVER guess file paths — use search or listing tools first

## CRITICAL: Read Existing Context Files First
Before exploring the codebase, READ these files if they exist — they contain valuable project context written by humans or other agents:

### Priority order:
1. \`CLAUDE.md\` — Claude Code project rules (root of project)
2. \`.mimo-context.md\` — Your own previous context (if exists)
3. \`.claude/settings.json\` — Claude Code project settings
4. \`.claude/rules/*.md\` — All scoped rule files (read each one)
5. \`.agent/memory/*.md\` — Antigravity memory files
6. \`.agent/AGENTS.md\` or \`AGENTS.md\` — Agent framework rules
7. \`.cursorrules\` — Cursor rules (if project uses Cursor)
8. \`.github/copilot-instructions.md\` — GitHub Copilot instructions

### How to check:
- Use \`list_files .\` to see root files
- Use \`list_files .claude\` and \`list_files .claude/rules\`
- Use \`list_files .agent\` and \`list_files .agent/memory\`
- Read each found file with \`read_file\`

### Why this matters:
- \`CLAUDE.md\` often contains build commands, conventions, architecture notes
- These files save you 10+ iterations of re-discovering what others already documented
- Respect the rules in these files — they represent the developer's preferences

## CRITICAL: Project Context Memory (.mimo-context.md)
You MUST maintain a context memory file to handle large projects efficiently.

### When starting a task:
1. FIRST, check if \`.mimo-context.md\` exists in the project root
2. If it exists, READ IT before exploring the codebase — it contains your previous findings
3. Only re-explore areas not covered in the context file

### While working:
- After discovering important information (architecture, file locations, patterns, configs),
  UPDATE \`.mimo-context.md\` immediately — don't wait until the end
- Structure the file with clear sections:

\`\`\`markdown
# MiMo Context — [Project Name]

## Task: [current task description]

## Architecture
- Framework: React + TypeScript + Mantine UI
- Backend: Firebase Functions + Firestore
- Auth: Firebase Auth

## Key Files
- src/types/index.ts — Patient, Professional, Appointment types
- src/services/firebase.ts — Firebase config and exports
- src/components/layout/MainLayout.tsx — Main navigation shell

## Current Task Progress
- [x] Step 1: Identified appointment flow
- [x] Step 2: Modified AppointmentModal.tsx
- [ ] Step 3: Update Firestore rules

## Notes & Patterns
- Uses DraggableModal for all modals
- CLINIC_ID imported from firebase.ts
- Form state uses useState hooks (not form libraries)

## Issues Found
- Line 45 in AppointmentModal.tsx: potential null reference
\`\`\`

### Why this matters:
- You have a large context window — use it to YOUR advantage
- The context file is YOUR memory between sessions
- It prevents re-reading the same files repeatedly
- For multi-step tasks across 20+ iterations, this is ESSENTIAL
- Update it at checkpoints AND whenever you discover something important`;
    register(context) {
        const participant = vscode.chat.createChatParticipant('mimo', this.handleRequest.bind(this));
        participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');
        participant.followupProvider = {
            provideFollowups: async () => [
                { prompt: 'Explain the code in the current file', label: '📖 Explain Code' },
                { prompt: 'Refactor this code for better readability', label: '🔧 Refactor' },
                { prompt: 'Add error handling to this function', label: '🛡️ Add Error Handling' },
                { prompt: 'Write unit tests for this module', label: '🧪 Write Tests' },
                { prompt: 'Find and fix any bugs in this code', label: '🐛 Find Bugs' },
                { prompt: 'Optimize this code for performance', label: '⚡ Optimize' }
            ]
        };
        return participant;
    }
    getApiKey() {
        const config = vscode.workspace.getConfiguration('mimo');
        const inspect = config.inspect('apiKey');
        return inspect?.workspaceValue || inspect?.globalValue || '';
    }
    getBaseUrl() {
        const config = vscode.workspace.getConfiguration('mimo');
        const inspect = config.inspect('baseUrl');
        return inspect?.workspaceValue || inspect?.globalValue || 'https://token-plan-ams.xiaomimimo.com/v1';
    }
    async handleRequest(request, context, stream, token) {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            stream.markdown('⚠️ **MiMo API Key no configurada.** Usa `Ctrl+Shift+P` → "MiMo: Configure API Key"');
            return;
        }
        // Build user message with context
        let userMessage = request.prompt;
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const selection = editor.selection;
            const selectedText = editor.document.getText(selection);
            if (selectedText) {
                userMessage += `\n\n[Selected code in ${editor.document.fileName}]\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;
            }
            // Add current file context
            const filePath = editor.document.fileName;
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
            const relPath = filePath.replace(workspaceRoot, '').replace(/\\/g, '/');
            userMessage += `\n\n[Current file: ${relPath}, line ${editor.selection.active.line + 1}]`;
        }
        // Add to conversation history
        this.conversationHistory.push({ role: 'user', content: userMessage });
        // Keep history manageable
        if (this.conversationHistory.length > 30) {
            // Keep system-relevant context but trim old messages
            this.conversationHistory = this.conversationHistory.slice(-20);
        }
        const baseUrl = this.getBaseUrl();
        const model = 'mimo-v2-pro';
        const maxIterations = 500; // Safety cap only
        const CHECKPOINT_INTERVAL = 20; // Force progress summary every N iterations
        try {
            let iteration = 0;
            let needsMoreToolCalls = true;
            while (needsMoreToolCalls && iteration < maxIterations) {
                if (token.isCancellationRequested) {
                    stream.markdown('\n\n⏹️ *Cancelado por el usuario.*');
                    return;
                }
                iteration++;
                // Force progress checkpoint every N iterations
                if (iteration > 1 && iteration % CHECKPOINT_INTERVAL === 1) {
                    stream.markdown(`\n\n📊 **Checkpoint (${iteration}/${maxIterations})** — pidiendo resumen de progreso...\n\n`);
                    this.conversationHistory.push({
                        role: 'user',
                        content: `⚠️ PUNTO DE CONTROL: Llevas ${iteration - 1} iteraciones. Antes de continuar, haz un resumen rápido de:
1. Qué has hecho hasta ahora
2. Qué falta por hacer
3. Si estás en un bucle o estancado, dilo claramente
Continúa después del resumen.`
                    });
                }
                if (iteration === 1) {
                    stream.progress('Pensando...');
                }
                else {
                    stream.progress(`Ejecutando herramienta (${iteration})...`);
                }
                // Build messages array
                const messages = [
                    { role: 'system', content: this.systemPrompt },
                    ...this.conversationHistory
                ];
                // Call MiMo API with tools
                const response = await fetch(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model,
                        messages,
                        tools: tools_1.TOOLS,
                        stream: false, // Non-streaming for tool calls
                        max_tokens: 4096,
                        temperature: 0.3
                    }),
                    signal: AbortSignal.timeout(120000)
                });
                if (!response.ok) {
                    const errorText = await response.text();
                    stream.markdown(`❌ **Error de MiMo** (${response.status}): ${errorText}`);
                    return;
                }
                const data = await response.json();
                const choice = data.choices?.[0];
                if (!choice) {
                    stream.markdown('❌ No se recibió respuesta válida de MiMo.');
                    return;
                }
                const message = choice.message;
                // If MiMo wants to call tools
                if (choice.finish_reason === 'tool_calls' && message.tool_calls) {
                    // Add assistant message (with tool calls) to history
                    this.conversationHistory.push({
                        role: 'assistant',
                        content: message.content || '',
                        tool_calls: message.tool_calls
                    });
                    // Execute each tool call
                    for (const toolCall of message.tool_calls) {
                        const tc = {
                            id: toolCall.id,
                            function: {
                                name: toolCall.function.name,
                                arguments: toolCall.function.arguments
                            }
                        };
                        // Show tool execution in stream
                        const args = JSON.parse(tc.function.arguments);
                        const toolLabel = this.formatToolCall(tc.function.name, args);
                        stream.markdown(`\n🔧 \`${toolLabel}\`\n`);
                        // Execute the tool
                        const result = await (0, tools_1.executeTool)(tc);
                        // Show abbreviated result
                        const displayResult = result.length > 500
                            ? result.substring(0, 500) + '\n... (ver resultado completo en el historial)'
                            : result;
                        stream.markdown(`\`\`\`\n${displayResult}\n\`\`\`\n`);
                        // Add tool result to history
                        this.conversationHistory.push({
                            role: 'tool',
                            content: result,
                            tool_call_id: tc.id
                        });
                    }
                }
                else {
                    // MiMo has a final text response
                    needsMoreToolCalls = false;
                    if (message.content) {
                        stream.markdown(message.content);
                        this.conversationHistory.push({
                            role: 'assistant',
                            content: message.content
                        });
                    }
                }
            }
            if (iteration >= maxIterations) {
                stream.markdown('\n\n⚠️ *Límite de seguridad alcanzado (' + maxIterations + ' iteraciones). Si necesitas más, repite el comando.*');
            }
        }
        catch (error) {
            if (error.name === 'AbortError' || error.name === 'TimeoutError') {
                stream.markdown('❌ **Timeout**: La conexión con MiMo tardó más de 120 segundos.');
            }
            else {
                stream.markdown(`❌ **Error**: ${error.message}`);
            }
        }
    }
    formatToolCall(name, args) {
        switch (name) {
            case 'read_file': return `read_file ${args.path}`;
            case 'write_file': return `write_file ${args.path} (${args.content?.length || 0} chars)`;
            case 'edit_file': return `edit_file ${args.path}`;
            case 'run_terminal': return `run: ${args.command}`;
            case 'search_files': return `search "${args.pattern}"`;
            case 'list_files': return `ls ${args.path || '.'}`;
            case 'get_diagnostics': return `diagnostics ${args.path || 'all'}`;
            default: return `${name}(${JSON.stringify(args)})`;
        }
    }
    clearHistory() {
        this.conversationHistory = [];
    }
}
exports.MiMoChatParticipant = MiMoChatParticipant;
//# sourceMappingURL=chat.js.map