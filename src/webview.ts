import * as vscode from 'vscode';
import { TOOLS, WEB_SEARCH_TOOL, executeTool, ToolCall } from './tools';
import { buildSystemPrompt, invalidatePromptCache } from './prompt';
import { ChatMessage, compressHistory, serializeHistory, deserializeHistory } from './context';
import { pickModel, getModel, getApiConfig } from './provider';

export class MiMoChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'mimo.chatView';

  private view?: vscode.WebviewView;
  private conversationHistory: ChatMessage[] = [];
  private pendingMessages: string[] = [];
  private isProcessing = false;
  private extensionContext?: vscode.ExtensionContext;

  constructor(private readonly extensionUri: vscode.Uri) {}

  public setExtensionContext(ctx: vscode.ExtensionContext) {
    this.extensionContext = ctx;
    const saved = ctx.workspaceState.get<string>('mimo.history');
    if (saved) {
      this.conversationHistory = deserializeHistory(saved);
    }
  }

  private persistHistory() {
    if (this.extensionContext) {
      this.extensionContext.workspaceState.update(
        'mimo.history',
        serializeHistory(this.conversationHistory)
      );
    }
  }

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

    webviewView.webview.onDidReceiveMessage((message) => {
      this.clearActiveWebview();
      this.handleWebviewMessage(message);
    });
  }

  public async handleUserMessage(text: string) {
    const { apiKey, baseUrl } = getApiConfig();
    if (!apiKey) {
      this.postMessage({ type: 'error', text: 'API Key not configured. Use Ctrl+Shift+P > "MiMo: Configure API Key"' });
      return;
    }

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
    this.conversationHistory = compressHistory(this.conversationHistory);

    this.isProcessing = true;
    this.postMessage({ type: 'startStreaming' });

    const maxIterations = 500;
    const CHECKPOINT_INTERVAL = 10;

    try {
      let iteration = 0;
      let needsMoreToolCalls = true;
      let lastToolName: string | undefined;

      while (needsMoreToolCalls && iteration < maxIterations) {
        iteration++;

        // Show progress to user — they see this in real time
        this.postMessage({ type: 'progress', step: iteration, max: maxIterations });

        while (this.pendingMessages.length > 0) {
          const queuedMsg = this.pendingMessages.shift()!;
          this.conversationHistory.push({
            role: 'user',
            content: `[User message during work]: ${queuedMsg}`
          });
        }

        // Checkpoint every N iterations — visible to user AND sent to model
        if (iteration > 1 && iteration % CHECKPOINT_INTERVAL === 0) {
          this.postMessage({ type: 'stream', text: `\n**[Checkpoint — step ${iteration}]** Requesting progress summary...\n` });
          this.conversationHistory.push({
            role: 'user',
            content: `CHECKPOINT: ${iteration} iterations done. Give a brief summary: 1) what you did 2) what remains 3) if stuck, say so clearly. Then continue.`
          });
        }

        const messages = [
          { role: 'system', content: buildSystemPrompt() },
          ...this.conversationHistory
        ];

        const modelId = pickModel(false, lastToolName);
        const modelSpec = getModel(modelId);

        // Only enable thinking on first iteration and after checkpoints.
        // Intermediate tool-call iterations use fast mode (no deep reasoning).
        const useThinking = modelSpec.supportsThinking && (iteration === 1 || iteration % CHECKPOINT_INTERVAL === 0);

        const requestBody: Record<string, any> = {
          model: modelId,
          messages,
          tools: vscode.workspace.getConfiguration('mimo').get('webSearch') ? [...TOOLS, WEB_SEARCH_TOOL] : TOOLS,
          stream: false,
          max_completion_tokens: Math.min(modelSpec.maxOutputTokens, 32768),
          temperature: modelId === 'mimo-v2-flash' ? 0.3 : 0.5
        };

        requestBody.thinking = { type: useThinking ? 'enabled' : 'disabled' };

        let response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(300000)
        });

        // Flash fallback to Pro
        if (!response.ok && modelId === 'mimo-v2-flash') {
          const fb = getModel('mimo-v2-pro');
          requestBody.model = 'mimo-v2-pro';
          requestBody.max_completion_tokens = Math.min(fb.maxOutputTokens, 32768);
          requestBody.thinking = { type: 'enabled' };
          response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(300000)
          });
        }

        if (!response.ok) {
          const errorText = await response.text();
          if (errorText.includes('web_search') || errorText.includes('plugin')) {
            this.postMessage({ type: 'error', text: `Web Search plugin not enabled. Enable at platform.xiaomimimo.com > Plugin Management.` });
          } else {
            this.postMessage({ type: 'error', text: `Error ${response.status}: ${errorText}` });
          }
          return;
        }

        const data = await response.json() as any;
        const choice = data.choices?.[0];
        if (!choice) { this.postMessage({ type: 'error', text: 'No valid response.' }); return; }

        if (data.usage) {
          this.postMessage({ type: 'tokenUsage', prompt: data.usage.prompt_tokens || 0, completion: data.usage.completion_tokens || 0, total: data.usage.total_tokens || 0 });
        }

        const message = choice.message;

        if (choice.finish_reason === 'tool_calls' && message.tool_calls) {
          this.conversationHistory.push({ role: 'assistant', content: message.content || '', tool_calls: message.tool_calls });

          for (const toolCall of message.tool_calls) {
            const tc: ToolCall = { id: toolCall.id, function: { name: toolCall.function.name, arguments: toolCall.function.arguments } };
            const args = JSON.parse(tc.function.arguments);
            this.postMessage({ type: 'toolCall', name: tc.function.name, args: this.formatToolCall(tc.function.name, args) });

            lastToolName = tc.function.name;
            const result = await executeTool(tc);
            this.postMessage({ type: 'toolResult', name: tc.function.name, result: result.length > 2000 ? result.substring(0, 2000) + '\n...' : result });
            // Truncate tool results in history to avoid bloating subsequent requests
            const historyResult = result.length > 4000 ? result.substring(0, 4000) + '\n... (truncated)' : result;
            this.conversationHistory.push({ role: 'tool', content: historyResult, tool_call_id: tc.id });
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
      this.postMessage({ type: 'error', text: error.name === 'TimeoutError' ? 'Timeout (120s)' : error.message });
    } finally {
      this.isProcessing = false;
      if (this.pendingMessages.length > 0) {
        const remaining = this.pendingMessages.splice(0);
        for (const msg of remaining) { this.conversationHistory.push({ role: 'user', content: msg }); }
      }
      this.persistHistory();
    }
  }

  private formatToolCall(name: string, args: any): string {
    switch (name) {
      case 'read_file': return `read ${args.path}${args.offset ? ':' + args.offset : ''}`;
      case 'write_file': return `write ${args.path}`;
      case 'edit_file': return `edit ${args.path}${args.replace_all ? ' (all)' : ''}`;
      case 'run_terminal': return `$ ${args.command}`;
      case 'search_files': return `search "${args.pattern}"${args.glob ? ' in ' + args.glob : ''}`;
      case 'list_files': return `ls ${args.path || '.'}${args.recursive ? ' -R' : ''}`;
      case 'find_files': return `find ${args.pattern}`;
      case 'get_diagnostics': return `diagnostics ${args.path || '(all)'}`;
      case 'read_image': return `image ${args.path}`;
      default: return `${name}(${JSON.stringify(args).substring(0, 100)})`;
    }
  }

  private async insertCodeToEditor(code: string) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      await editor.edit((editBuilder) => {
        const selection = editor.selection;
        if (!selection.isEmpty) { editBuilder.replace(selection, code); }
        else { editBuilder.insert(selection.active, code); }
      });
    }
  }

  private activeWebview?: vscode.Webview;
  public setActiveWebview(webview: vscode.Webview) { this.activeWebview = webview; }
  public clearActiveWebview() { this.activeWebview = undefined; }

  private postMessage(message: any) {
    const webview = this.activeWebview ?? this.view?.webview;
    webview?.postMessage(message);
  }

  public clearHistory() {
    this.conversationHistory = [];
    this.pendingMessages = [];
    invalidatePromptCache();
    this.postMessage({ type: 'historyCleared' });
    this.persistHistory();
  }

  public async handleWebviewMessage(message: any) {
    switch (message.type) {
      case 'sendMessage':
        if (this.isProcessing) {
          this.pendingMessages.push(message.text);
          this.postMessage({ type: 'stream', text: '*(Message queued — will be incorporated in the next step)*\n' });
        } else {
          await this.handleUserMessage(message.text);
        }
        break;
      case 'stopProcessing':
        this.isProcessing = false;
        this.pendingMessages = [];
        this.postMessage({ type: 'streamEnd' });
        break;
      case 'openNewTab':
        vscode.commands.executeCommand('mimo.openChat');
        break;
      case 'clearHistory':
        this.clearHistory();
        break;
      case 'insertCode':
        await this.insertCodeToEditor(message.code);
        break;
      case 'pickFile': {
        const fileUris = await vscode.window.showOpenDialog({
          canSelectMany: true, openLabel: 'Add as context',
          filters: { 'Code files': ['ts', 'tsx', 'js', 'jsx', 'json', 'md', 'py', 'css', 'html'], 'All files': ['*'] }
        });
        if (fileUris) {
          for (const uri of fileUris) {
            this.postMessage({ type: 'filePicked', path: vscode.workspace.asRelativePath(uri) });
          }
        }
        break;
      }
      case 'attachFiles':
        for (const filePath of message.files) {
          try {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (root) {
              const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.Uri.file(root), filePath));
              this.conversationHistory.push({ role: 'user', content: `[Context: ${filePath}]\n\`\`\`${doc.languageId}\n${doc.getText().substring(0, 50000)}\n\`\`\`` });
            }
          } catch (err: any) {
            this.postMessage({ type: 'error', text: `Cannot read ${filePath}: ${err.message}` });
          }
        }
        break;
    }
  }

  public getHtml(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'icon.png'));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.js'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <link href="${cssUri}" rel="stylesheet">
  <title>MiMo Chat</title>
</head>
<body>
  <div id="messages">
    <div class="welcome" id="welcome">
      <img src="${iconUri}" alt="MiMo">
      <h2>MiMo by Xiaomi</h2>
      <p>AI coding assistant powered by MiMo V2.<br>I can read files, edit code, run commands, and search the web.</p>
      <div class="quick-actions">
        <button data-action="Explain the current file">Explain</button>
        <button data-action="Refactor this code">Refactor</button>
        <button data-action="Find bugs in this code">Debug</button>
        <button data-action="Run the tests">Test</button>
      </div>
    </div>
  </div>
  <div class="input-area">
    <div id="attachedFiles" class="attached-files"></div>
    <div class="input-row">
      <textarea id="input" placeholder="Ask MiMo..." rows="1"></textarea>
      <button id="sendBtn" class="send-btn" title="Send">&#x2191;</button>
    </div>
    <div class="input-toolbar">
      <div class="left">
        <button id="addContextBtn" class="toolbar-btn" title="Attach file">+ File</button>
        <button id="tokenUsageBtn" class="toolbar-btn" title="Token usage">Usage</button>
      </div>
      <div class="right">
        <button id="stopBtn" class="toolbar-btn danger" title="Stop" style="display:none">Stop</button>
        <button id="newTabBtn" class="toolbar-btn" title="Open new tab">+ Tab</button>
        <button id="newChatBtn" class="toolbar-btn danger" title="Clear this conversation">Clear</button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}" src="${jsUri}"></script>
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
