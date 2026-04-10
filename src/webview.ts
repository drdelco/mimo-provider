import * as vscode from 'vscode';
import { TOOLS, executeTool, ToolCall } from './tools';

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export class MiMoChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'mimo.chatView';

  private view?: vscode.WebviewView;
  private conversationHistory: ChatMessage[] = [];
  private pendingMessages: string[] = [];
  private isProcessing = false;
  private readonly systemPrompt = `You are MiMo, an advanced AI coding assistant by Xiaomi. You are running inside Antigravity IDE.

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

  constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'sendMessage':
          if (this.isProcessing) {
            this.pendingMessages.push(message.text);
            this.postMessage({ type: 'stream', text: `⏳ *Mensaje recibido — se incorporará en el siguiente paso.*\n\n` });
          } else {
            await this.handleUserMessage(message.text);
          }
          break;
        case 'stopProcessing':
          this.isProcessing = false;
          this.pendingMessages = [];
          this.postMessage({ type: 'stream', text: '\n\n⏹ *Procesamiento detenido por el usuario.*\n' });
          this.postMessage({ type: 'streamEnd' });
          break;
        case 'clearHistory':
          this.conversationHistory = [];
          this.pendingMessages = [];
          this.postMessage({ type: 'historyCleared' });
          break;
        case 'insertCode':
          await this.insertCodeToEditor(message.code);
          break;
        case 'pickFile':
          const fileUris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            openLabel: 'Add as context',
            filters: { 'Code files': ['ts', 'tsx', 'js', 'jsx', 'json', 'md', 'py', 'css', 'html'], 'All files': ['*'] }
          });
          if (fileUris) {
            for (const uri of fileUris) {
              const relPath = vscode.workspace.asRelativePath(uri);
              this.postMessage({ type: 'filePicked', path: relPath });
            }
          }
          break;
        case 'attachFiles':
          // Read file contents and add to conversation as system context
          for (const filePath of message.files) {
            try {
              const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
              if (workspaceRoot) {
                const fullPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), filePath);
                const doc = await vscode.workspace.openTextDocument(fullPath);
                const content = doc.getText().substring(0, 50000); // Limit to 50K chars
                this.conversationHistory.push({
                  role: 'user',
                  content: `[Context file: ${filePath}]\n\`\`\`${doc.languageId}\n${content}\n\`\`\``
                });
              }
            } catch (err: any) {
              this.postMessage({ type: 'stream', text: `⚠️ No se pudo leer ${filePath}: ${err.message}\n` });
            }
          }
          break;
      }
    });
  }

  private getApiKey(): string {
    const config = vscode.workspace.getConfiguration('mimo');
    const inspect = config.inspect<string>('apiKey');
    return inspect?.workspaceValue || inspect?.globalValue || '';
  }

  private getBaseUrl(): string {
    const config = vscode.workspace.getConfiguration('mimo');
    const inspect = config.inspect<string>('baseUrl');
    return inspect?.workspaceValue || inspect?.globalValue || 'https://token-plan-ams.xiaomimimo.com/v1';
  }

  public async handleUserMessage(text: string) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.postMessage({
        type: 'error',
        text: 'API Key no configurada. Usa Ctrl+Shift+P → "MiMo: Configure API Key"'
      });
      return;
    }

    // Add editor context
    let userMessage = text;
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      if (selectedText) {
        userMessage += `\n\n[Selected code]\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;
      }
    }

    this.conversationHistory.push({ role: 'user', content: userMessage });
    if (this.conversationHistory.length > 30) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }

    this.isProcessing = true;
    this.postMessage({ type: 'startStreaming' });

    const baseUrl = this.getBaseUrl();
    const maxIterations = 500; // Safety cap only
    const CHECKPOINT_INTERVAL = 20; // Force progress summary every N iterations

    try {
      let iteration = 0;
      let needsMoreToolCalls = true;

      while (needsMoreToolCalls && iteration < maxIterations) {
        iteration++;

        // Inject any pending user messages mid-loop
        while (this.pendingMessages.length > 0) {
          const queuedMsg = this.pendingMessages.shift()!;
          this.conversationHistory.push({
            role: 'user',
            content: `📨 [Mensaje del usuario durante el trabajo]: ${queuedMsg}`
          });
          this.postMessage({ type: 'stream', text: `📨 *Incorporando tu mensaje en el flujo de trabajo...*\n\n` });
        }

        // Force progress checkpoint every N iterations
        if (iteration > 1 && iteration % CHECKPOINT_INTERVAL === 1) {
          this.postMessage({ type: 'stream', text: `\n\n📊 **Checkpoint (${iteration}/${maxIterations})** — pidiendo resumen de progreso...\n\n` });
          this.conversationHistory.push({
            role: 'user',
            content: `⚠️ PUNTO DE CONTROL: Llevas ${iteration - 1} iteraciones. Antes de continuar, haz un resumen rápido de:
1. Qué has hecho hasta ahora
2. Qué falta por hacer
3. Si estás en un bucle o estancado, dilo claramente
Continúa después del resumen.`
          });
        }

        const messages = [
          { role: 'system', content: this.systemPrompt },
          ...this.conversationHistory
        ];

        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'mimo-v2-pro',
            messages,
            tools: TOOLS,
            stream: false,
            max_tokens: 4096,
            temperature: 0.3
          }),
          signal: AbortSignal.timeout(120000)
        });

        if (!response.ok) {
          const errorText = await response.text();
          this.postMessage({ type: 'error', text: `Error ${response.status}: ${errorText}` });
          return;
        }

        const data = await response.json() as any;
        const choice = data.choices?.[0];
        if (!choice) {
          this.postMessage({ type: 'error', text: 'No se recibió respuesta válida.' });
          return;
        }

        // Track token usage from API response
        if (data.usage) {
          this.postMessage({
            type: 'tokenUsage',
            prompt: data.usage.prompt_tokens || 0,
            completion: data.usage.completion_tokens || 0,
            total: data.usage.total_tokens || 0
          });
        }

        const message = choice.message;

        if (choice.finish_reason === 'tool_calls' && message.tool_calls) {
          this.conversationHistory.push({
            role: 'assistant',
            content: message.content || '',
            tool_calls: message.tool_calls
          });

          for (const toolCall of message.tool_calls) {
            const tc: ToolCall = {
              id: toolCall.id,
              function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments
              }
            };

            const args = JSON.parse(tc.function.arguments);
            this.postMessage({
              type: 'toolCall',
              name: tc.function.name,
              args: this.formatToolCall(tc.function.name, args)
            });

            const result = await executeTool(tc);

            this.postMessage({
              type: 'toolResult',
              name: tc.function.name,
              result: result.length > 2000 ? result.substring(0, 2000) + '\n...' : result
            });

            this.conversationHistory.push({
              role: 'tool',
              content: result,
              tool_call_id: tc.id
            });
          }
        } else {
          needsMoreToolCalls = false;

          if (message.content) {
            this.postMessage({ type: 'assistantMessage', text: message.content });
            this.conversationHistory.push({ role: 'assistant', content: message.content });
          }
        }
      }

      this.postMessage({ type: 'streamEnd' });

    } catch (error: any) {
      this.postMessage({
        type: 'error',
        text: error.name === 'TimeoutError' ? 'Timeout (120s)' : error.message
      });
    } finally {
      this.isProcessing = false;
      // Flush any remaining pending messages as new user messages
      if (this.pendingMessages.length > 0) {
        const remaining = this.pendingMessages.splice(0);
        for (const msg of remaining) {
          this.conversationHistory.push({ role: 'user', content: msg });
        }
        this.postMessage({ type: 'stream', text: `📨 *${remaining.length} mensaje(s) pendiente(s) guardado(s) para la siguiente interacción.*\n\n` });
      }
    }
  }

  private formatToolCall(name: string, args: any): string {
    switch (name) {
      case 'read_file': return `📖 Reading ${args.path}`;
      case 'write_file': return `✏️ Writing ${args.path}`;
      case 'edit_file': return `✏️ Editing ${args.path}`;
      case 'run_terminal': return `💻 ${args.command}`;
      case 'search_files': return `🔍 Searching "${args.pattern}"`;
      case 'list_files': return `📁 Listing ${args.path || '.'}`;
      case 'get_diagnostics': return `🩺 Checking diagnostics`;
      default: return `${name}(${JSON.stringify(args).substring(0, 100)})`;
    }
  }

  private async insertCodeToEditor(code: string) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      await editor.edit((editBuilder) => {
        const selection = editor.selection;
        if (!selection.isEmpty) {
          editBuilder.replace(selection, code);
        } else {
          editBuilder.insert(selection.active, code);
        }
      });
    }
  }

  private postMessage(message: any) {
    this.view?.webview.postMessage(message);
  }

  public clearHistory() {
    this.conversationHistory = [];
    this.postMessage({ type: 'historyCleared' });
  }

  public getHtml(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'icon.png'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <title>MiMo Chat</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .header img { width: 24px; height: 24px; }
    .header h3 { font-size: 14px; font-weight: 600; }
    .header .spacer { flex: 1; }
    .header button {
      background: none;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
    }
    .header button:hover { background: var(--vscode-toolbar-hoverBackground); }
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .message {
      padding: 8px 12px;
      border-radius: 8px;
      line-height: 1.5;
      word-wrap: break-word;
    }
    .user-msg {
      background: var(--vscode-inputValidation-infoBackground);
      align-self: flex-end;
      max-width: 85%;
    }
    .assistant-msg {
      background: var(--vscode-editor-inactiveSelectionBackground);
      align-self: flex-start;
      max-width: 95%;
    }
    .tool-msg {
      background: var(--vscode-editorWidget-background);
      border-left: 3px solid var(--vscode-activityBarBadge-background);
      padding: 6px 10px;
      font-size: 12px;
      align-self: flex-start;
      max-width: 95%;
    }
    .tool-result {
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      white-space: pre-wrap;
      max-height: 150px;
      overflow-y: auto;
      background: var(--vscode-textCodeBlock-background);
      padding: 6px;
      border-radius: 4px;
      margin-top: 4px;
    }
    .error-msg {
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
      border-radius: 8px;
    }
    pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 12px;
    }
    code { font-family: var(--vscode-editor-font-family); }
    .typing { opacity: 0.6; font-style: italic; }
    .input-area {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid var(--vscode-panel-border);
      align-items: flex-end;
    }
    .input-controls {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .input-controls button {
      background: none;
      border: none;
      color: var(--vscode-descriptionForeground);
      border-radius: 4px;
      width: 28px;
      height: 28px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    .input-controls button:hover { color: var(--vscode-foreground); }
    .input-controls #stopBtn { color: var(--vscode-errorForeground); }
    .input-controls #stopBtn:hover { color: var(--vscode-inputValidation-errorForeground); }
    .input-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .attached-files {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .attached-file {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .attached-file button {
      background: none;
      border: none;
      color: var(--vscode-badge-foreground);
      cursor: pointer;
      font-size: 12px;
      padding: 0;
      line-height: 1;
    }
    .token-usage {
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 12px;
      margin: 8px 12px;
      font-size: 12px;
    }
    .token-usage h4 { margin-bottom: 8px; font-size: 13px; }
    .token-usage .bar {
      height: 6px;
      background: var(--vscode-progressBar-background);
      border-radius: 3px;
      margin: 4px 0;
    }
    .token-usage .bar-fill {
      height: 100%;
      background: var(--vscode-activityBarBadge-background);
      border-radius: 3px;
      transition: width 0.3s;
    }
    .input-area textarea {
      flex: 1;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 6px;
      padding: 8px 12px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      resize: none;
      min-height: 40px;
      max-height: 120px;
    }
    .input-area textarea:focus { outline: none; border-color: var(--vscode-focusBorder); }
    .welcome {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 40px 20px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }
    .welcome img { width: 48px; height: 48px; opacity: 0.7; }
    .welcome h2 { font-size: 16px; color: var(--vscode-foreground); }
    .welcome p { font-size: 12px; line-height: 1.6; }
    .quick-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
      margin-top: 12px;
    }
    .quick-actions button {
      background: none;
      color: var(--vscode-descriptionForeground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
    }
    .quick-actions button:hover { color: var(--vscode-foreground); border-color: var(--vscode-foreground); }
    .insert-btn {
      background: none;
      border: 1px solid var(--vscode-button-background);
      color: var(--vscode-button-background);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      cursor: pointer;
      margin-top: 4px;
    }
    .insert-btn:hover { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  </style>
</head>
<body>
  <div class="header">
    <img src="${iconUri}" alt="MiMo">
    <h3>MiMo by Xiaomi</h3>
    <div class="spacer"></div>
    <button id="clearBtn" title="New chat">🗑️ New</button>
  </div>
  <div id="messages">
    <div class="welcome" id="welcome">
      <img src="${iconUri}" alt="MiMo">
      <h2>Welcome to MiMo</h2>
      <p>AI coding assistant powered by Xiaomi MiMo V2.<br>I can read files, edit code, run commands, and more.</p>
      <div class="quick-actions" id="quickActions">
        <button data-action="Explain the current file">Explain</button>
        <button data-action="Refactor this code">Refactor</button>
        <button data-action="Find bugs in this code">Debug</button>
        <button data-action="Run the tests">Test</button>
      </div>
    </div>
  </div>
  <div class="input-area">
    <div class="input-controls">
      <button id="addContextBtn" title="Attach file (context)">📎</button>
      <button id="tokenUsageBtn" title="Token usage">📊</button>
      <button id="stopBtn" title="Stop processing" style="display:none">⏹</button>
    </div>
    <div class="input-wrapper">
      <div id="attachedFiles" class="attached-files"></div>
      <textarea id="input" placeholder="Ask MiMo... (Enter to send, Shift+Enter for new line)" rows="1"></textarea>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const clearBtn = document.getElementById('clearBtn');
    const welcomeEl = document.getElementById('welcome');
    const addContextBtn = document.getElementById('addContextBtn');
    const tokenUsageBtn = document.getElementById('tokenUsageBtn');
    const stopBtn = document.getElementById('stopBtn');
    const attachedFilesEl = document.getElementById('attachedFiles');

    let attachedFiles = [];
    let totalTokensUsed = 0;
    let sessionMessages = 0;

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function addMessage(html, className) {
      const div = document.createElement('div');
      div.className = 'message ' + className;
      div.innerHTML = html;
      messagesEl.appendChild(div);
      scrollToBottom();
      return div;
    }

    window.sendQuick = function(text) {
      inputEl.value = text;
      sendMessage();
    };

    // Quick action buttons (CSP-safe)
    document.querySelectorAll('#quickActions button').forEach(btn => {
      btn.addEventListener('click', () => {
        sendQuick(btn.getAttribute('data-action') || '');
      });
    });

    function sendMessage() {
      let text = inputEl.value.trim();
      if (!text) return;
      // Append attached file contents
      if (attachedFiles.length > 0) {
        text += '\n\n[Context files attached:';
        attachedFiles.forEach(f => { text += '\n- ' + f; });
        text += ']';
        // Tell backend to read these files
        vscode.postMessage({ type: 'attachFiles', files: attachedFiles });
        attachedFiles = [];
        renderAttachedFiles();
      }
      if (welcomeEl) welcomeEl.style.display = 'none';
      addMessage(escapeHtml(text), 'user-msg');
      inputEl.value = '';
      inputEl.style.height = 'auto';
      sessionMessages++;
      vscode.postMessage({ type: 'sendMessage', text });
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function extractCode(text) {
      const match = text.match(/\`\`\`\\w*\\n([\\s\\S]*?)\\n\`\`\`/);
      return match ? match[1] : null;
    }

    // Add context file button
    addContextBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'pickFile' });
    });

    // Token usage button
    tokenUsageBtn.addEventListener('click', () => {
      const existing = document.querySelector('.token-usage');
      if (existing) { existing.remove(); return; }
      const div = document.createElement('div');
      div.className = 'token-usage';
      const pct = totalTokensUsed > 0 ? Math.min((totalTokensUsed / 1000000) * 100, 100) : 0;
      div.innerHTML = \`
        <h4>📊 Token Usage — This Session</h4>
        <div>Tokens used: <strong>\${totalTokensUsed.toLocaleString()}</strong></div>
        <div>Messages: <strong>\${sessionMessages}</strong></div>
        <div class="bar"><div class="bar-fill" style="width: \${pct}%"></div></div>
        <div style="font-size:11px;color:var(--vscode-descriptionForeground)">
          Context: MiMo V2 Pro — 131K tokens window
        </div>
        <div style="margin-top:8px">
          <a href="https://platform.xiaomimimo.com/#/console/plan-manage" style="color:var(--vscode-textLink-foreground)">📊 Ver cuota restante en MiMo Platform</a>
        </div>
      \`;
      messagesEl.insertBefore(div, messagesEl.firstChild);
      scrollToBottom();
    });

    // Stop button
    stopBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'stopProcessing' });
      stopBtn.style.display = 'none';
      addMessage('⏹ Stopped by user.', 'assistant-msg');
    });

    // Listen for file picker response
    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.type === 'filePicked') {
        attachedFiles.push(msg.path);
        renderAttachedFiles();
      }
    });

    function renderAttachedFiles() {
      attachedFilesEl.innerHTML = '';
      attachedFiles.forEach((f, i) => {
        const chip = document.createElement('span');
        chip.className = 'attached-file';
        const name = f.split(/[/\\]/).pop();
        chip.textContent = name;
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '\u00D7';
        removeBtn.addEventListener('click', () => {
          attachedFiles.splice(i, 1);
          renderAttachedFiles();
        });
        chip.appendChild(removeBtn);
        attachedFilesEl.appendChild(chip);
      });
    }

    clearBtn.addEventListener('click', () => {
      messagesEl.innerHTML = '';
      vscode.postMessage({ type: 'clearHistory' });
      const w = document.createElement('div');
      w.className = 'welcome';
      w.id = 'welcome';
      w.innerHTML = document.querySelector('.welcome')?.innerHTML || '';
      messagesEl.appendChild(w);
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });

    let currentAssistantDiv = null;

    window.addEventListener('message', (e) => {
      const msg = e.data;
      switch (msg.type) {
        case 'startStreaming':
          currentAssistantDiv = addMessage('', 'assistant-msg');
          stopBtn.style.display = 'flex';
          break;
        case 'assistantMessage':
          if (currentAssistantDiv) {
            currentAssistantDiv.innerHTML = renderMarkdown(msg.text);
            const code = extractCode(msg.text);
            if (code) {
              const btn = document.createElement('button');
              btn.className = 'insert-btn';
              btn.textContent = '📋 Insert into editor';
              btn.onclick = () => vscode.postMessage({ type: 'insertCode', code });
              currentAssistantDiv.appendChild(btn);
            }
          }
          scrollToBottom();
          break;
        case 'toolCall':
          addMessage(msg.args, 'tool-msg');
          break;
        case 'toolResult':
          addMessage('<div class="tool-result">' + escapeHtml(msg.result) + '</div>', 'tool-msg');
          break;
        case 'error':
          addMessage('❌ ' + msg.text, 'error-msg');
          break;
        case 'tokenUsage':
          totalTokensUsed += msg.total;
          break;
        case 'streamEnd':
          currentAssistantDiv = null;
          stopBtn.style.display = 'none';
          inputEl.focus();
          break;
        case 'historyCleared':
          totalTokensUsed = 0;
          sessionMessages = 0;
          break;
      }
    });

    function renderMarkdown(text) {
      return text
        .replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\\n\`\`\`/g, '<pre><code>$2</code></pre>')
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
        .replace(/\\*\\*([^\\*]+)\\*\\*/g, '<strong>$1</strong>')
        .replace(/\\n/g, '<br>');
    }
  </script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
