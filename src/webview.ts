import * as vscode from 'vscode';
import { TOOLS, WEB_SEARCH_TOOL, LOCAL_WEB_TOOLS, executeTool, ToolCall, containsWebSearchXml, executeWebSearchFromXml } from './tools';
import { buildSystemPrompt, invalidatePromptCache } from './prompt';
import { ChatMessage, compressHistory, serializeHistory, deserializeHistory } from './context';
import { pickModel, getModel, getModels, getApiConfig, fetchModelsFromApi, getModelOptions, getApiConfigForModel, getApiConfigForModelAsync, markModelSuccess, markModelFailed, getFallbackChain } from './provider';

export class MiMoChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'mimo.chatView';

  private view?: vscode.WebviewView;
  private conversationHistory: ChatMessage[] = [];
  private pendingMessages: string[] = [];
  private isProcessing = false;
  private extensionContext?: vscode.ExtensionContext;
  private tabId?: number;
  private _pendingImages: string[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** Set the tab ID for independent history persistence (tabs only, not sidebar) */
  public setTabId(id: number) { this.tabId = id; }
  public getTabId(): number | undefined { return this.tabId; }

  public setExtensionContext(ctx: vscode.ExtensionContext) {
    this.extensionContext = ctx;
    const key = this.tabId ? `mimo.tab.${this.tabId}.history` : 'mimo.history';
    const saved = ctx.workspaceState.get<string>(key);
    if (saved) {
      this.conversationHistory = deserializeHistory(saved);
    }
  }

  private persistHistory() {
    if (this.extensionContext) {
      const key = this.tabId ? `mimo.tab.${this.tabId}.history` : 'mimo.history';
      this.extensionContext.workspaceState.update(key, serializeHistory(this.conversationHistory));
    }
  }

  /** Check if this provider has conversation history loaded */
  public hasHistory(): boolean { return this.conversationHistory.length > 0; }

  /** Return history in a format the webview can render */
  public getHistoryForRestore(): { role: string; content: string }[] {
    return this.conversationHistory
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content && !m.tool_calls)
      .map(m => ({ role: m.role, content: m.content }));
  }

  /** Clean up persisted history for this tab */
  public removePersistedHistory() {
    if (this.extensionContext && this.tabId) {
      this.extensionContext.workspaceState.update(`mimo.tab.${this.tabId}.history`, undefined);
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
    const baseConfig = getApiConfig();
    if (!baseConfig.apiKey) {
      // Also check OAuth providers
      const { getValidToken } = await import('./oauth');
      const hasKimiOAuth = await getValidToken('kimi');
      const hasMiniMaxOAuth = await getValidToken('minimax');
      if (!hasKimiOAuth && !hasMiniMaxOAuth) {
        this.postMessage({ type: 'error', text: 'API Key not configured. Use Ctrl+Shift+P > MiMo: Configure API Key or MiMo: Login to Kimi/MiniMax' });
        return;
      }
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
      const toolsUsed: string[] = [];       // Track tool history for summaries
      const filesRead = new Set<string>();
      const filesModified = new Set<string>();

      while (needsMoreToolCalls && iteration < maxIterations) {
        iteration++;

        // ---- Visible feedback: BEFORE API call ----
        const stepLabel = iteration === 1 ? 'Analyzing your request...'
          : lastToolName ? `Continuing after ${this.friendlyToolName(lastToolName)}...`
          : 'Processing...';
        this.postMessage({ type: 'step', text: `Step ${iteration} â€” ${stepLabel}` });

        // Inject pending user messages
        while (this.pendingMessages.length > 0) {
          const queuedMsg = this.pendingMessages.shift()!;
          this.conversationHistory.push({ role: 'user', content: `[User message during work]: ${queuedMsg}` });
          this.postMessage({ type: 'step', text: `Step ${iteration} â€” incorporating your message...` });
        }

        // Checkpoint every N iterations
        if (iteration > 1 && iteration % CHECKPOINT_INTERVAL === 0) {
          this.postMessage({ type: 'step', text: `Step ${iteration} â€” checkpoint, requesting progress summary...` });
          this.conversationHistory.push({
            role: 'user',
            content: `CHECKPOINT: ${iteration} iterations done. Give a brief summary: 1) what you did 2) what remains 3) if stuck, say so clearly. Then continue.`
          });
        }

        let modelId = pickModel(this._pendingImages.length > 0, lastToolName, iteration);
        let modelSpec = getModel(modelId);
        let { apiKey, baseUrl } = await getApiConfigForModelAsync(modelId);
        const isDeepSeek = modelId.startsWith('deepseek');
        const isMiniMax = modelId.startsWith('MiniMax') || modelId.startsWith('minimax');
        const needsDuckDuckGo = isDeepSeek || isMiniMax;

        // Build messages array, injecting pending images into the last user message
        const rawMessages: any[] = [
          { role: 'system', content: buildSystemPrompt() },
          ...this.conversationHistory
        ];

        // If there are pending images and the model supports vision, inject them
        if (this._pendingImages.length > 0 && modelSpec.supportsVision) {
          for (let i = rawMessages.length - 1; i >= 0; i--) {
            if (rawMessages[i].role === 'user') {
              const contentParts: any[] = [{ type: 'text', text: rawMessages[i].content }];
              for (const imgDataUrl of this._pendingImages) {
                contentParts.push({
                  type: 'image_url',
                  image_url: { url: imgDataUrl, detail: 'high' }
                });
              }
              rawMessages[i] = { role: 'user', content: contentParts };
              break;
            }
          }
          this._pendingImages = []; // Clear after use
          // Tell the webview to remove the image thumbnails
          this.postMessage({ type: 'clearImages' });
        } else if (this._pendingImages.length > 0 && !modelSpec.supportsVision) {
          // No vision model available â€” use read_image tool as fallback
          // Save images to temp files and inject read_image tool calls into the conversation
          this.postMessage({ type: 'step', text: 'Step ' + iteration + ' â€” images detected, switching to vision-capable model...' });
          // Force switch to a vision model for this iteration
          const visionModels = getModels().filter(m => m.supportsVision);
          if (visionModels.length > 0) {
            // Override the model for this request
            const visionModel = visionModels[0];
            modelId = visionModel.id;
            modelSpec = visionModel;
            const vc = await getApiConfigForModelAsync(modelId);
            apiKey = vc.apiKey;
            baseUrl = vc.baseUrl;
            // Re-inject images with the vision model
            for (let i = rawMessages.length - 1; i >= 0; i--) {
              if (rawMessages[i].role === 'user') {
                const contentParts: any[] = [{ type: 'text', text: rawMessages[i].content }];
                for (const imgDataUrl of this._pendingImages) {
                  contentParts.push({
                    type: 'image_url',
                    image_url: { url: imgDataUrl, detail: 'high' }
                  });
                }
                rawMessages[i] = { role: 'user', content: contentParts };
                break;
              }
            }
            this._pendingImages = [];
            this.postMessage({ type: 'clearImages' });
          } else {
            // Truly no vision model â€” clear images and inform user
            this._pendingImages = [];
            this.postMessage({ type: 'clearImages' });
            this.postMessage({ type: 'stream', text: '*No vision-capable model available. Images were discarded. Please describe what you see in the screenshot.*\n' });
          }
        }

        const messages = rawMessages;

        // Only think on first iteration and checkpoints â€” fast mode for tool calls
        const useThinking = modelSpec.supportsThinking && (iteration === 1 || iteration % CHECKPOINT_INTERVAL === 0);

        const useXiaomiSearch = vscode.workspace.getConfiguration('mimo').get('webSearch');
        // Xiaomi builtin_function ($web_search) is not compatible with DeepSeek
        const tools = needsDuckDuckGo
          ? [...TOOLS, ...LOCAL_WEB_TOOLS]
          : (useXiaomiSearch ? [...TOOLS, ...LOCAL_WEB_TOOLS, WEB_SEARCH_TOOL] : [...TOOLS, ...LOCAL_WEB_TOOLS]);
        const requestBody: Record<string, any> = {
          model: modelId,
          messages,
          tools,
          stream: true,
          max_completion_tokens: Math.min(modelSpec.maxOutputTokens, 32768),
          temperature: modelId === 'mimo-v2-flash' ? 0.3 : 0.5,
          ...(needsDuckDuckGo ? {} : { thinking: { type: useThinking ? 'enabled' : 'disabled' } })
        };

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
          if (!needsDuckDuckGo) { requestBody.thinking = { type: 'enabled' }; }
          response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(300000)
          });
        }

        // Web search fallback: if Xiaomi/Kimi plugin fails, retry with DuckDuckGo
        if (!response.ok && useXiaomiSearch) {
          const errDetail = await response.text().catch(() => '');
          this.postMessage({ type: 'stream', text: `*$web_search failed (${response.status}: ${errDetail.substring(0, 100)}) - switching to DuckDuckGo...*\n` });
          requestBody.tools = [...TOOLS, ...LOCAL_WEB_TOOLS];
          response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(300000)
          });
        }

        // Cross-provider fallback: try other models if the current one fails
        if (!response.ok) {
          markModelFailed(modelId);
          const fallbackChain = getFallbackChain(modelId, false);
          let fallbackSuccess = false;

          for (const fallbackId of fallbackChain) {
            const fbSpec = getModel(fallbackId);
            const fbConfig = await getApiConfigForModelAsync(fallbackId);
            const fbIsDeepSeek = fallbackId.startsWith('deepseek');
            const fbIsMiniMax = fallbackId.startsWith('MiniMax') || fallbackId.startsWith('minimax');
            const fbNeedsDuckDuckGo = fbIsDeepSeek || fbIsMiniMax;

            this.postMessage({ type: 'stream', text: `*Model ${modelId} failed (${response.status}) - trying ${fallbackId}...*\n` });

            requestBody.model = fallbackId;
            requestBody.max_completion_tokens = Math.min(fbSpec.maxOutputTokens, 32768);
            if (fbNeedsDuckDuckGo) {
              delete requestBody.thinking;
              requestBody.tools = [...TOOLS, ...LOCAL_WEB_TOOLS];
            } else {
              requestBody.thinking = { type: 'enabled' };
            }

            response = await fetch(`${fbConfig.baseUrl}/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${fbConfig.apiKey}` },
              body: JSON.stringify(requestBody),
              signal: AbortSignal.timeout(300000)
            });

            if (response.ok) {
              markModelSuccess(fallbackId);
              fallbackSuccess = true;
              break;
            }
          }

          if (!fallbackSuccess) {
            const errorText = await response.text();
            this.postMessage({ type: 'error', text: `Error - all models failed. Last error (${response.status}): ${errorText}` });
            return;
          }
        } else {
          markModelSuccess(modelId);
        }

        // ---- Parse SSE stream ----
        const parsed = await this.parseSSEResponse(response);

        if (parsed.usage) {
          this.postMessage({ type: 'tokenUsage', prompt: parsed.usage.prompt_tokens || 0, completion: parsed.usage.completion_tokens || 0, total: parsed.usage.total_tokens || 0 });
        }

        // ---- $web_search XML handling ----
        if (parsed.content && parsed.finishReason === 'tool_calls' && containsWebSearchXml(parsed.content)) {
          this.postMessage({ type: 'toolCall', name: 'web_search', args: 'Searching the web...' });
          const searchResult = await executeWebSearchFromXml(parsed.content);
          if (searchResult) {
            this.postMessage({ type: 'toolResult', name: 'web_search', result: searchResult.results.length > 2000 ? searchResult.results.substring(0, 2000) + '\n...' : searchResult.results });
            this.conversationHistory.push({ role: 'assistant', content: parsed.content });
            this.conversationHistory.push({ role: 'user', content: `[Web search results for: ${searchResult.query}]\n\n${searchResult.results}` });
            continue;
          }
        }

        // ---- Tool calls ----
        if (parsed.toolCalls.length > 0) {
          // Show any intermediate text from MiMo (only if not already streamed token-by-token)
          if (parsed.content && !parsed.wasStreamed) {
            this.postMessage({ type: 'stream', text: parsed.content + '\n' });
          }

          this.conversationHistory.push({ role: 'assistant', content: parsed.content || '', tool_calls: parsed.toolCalls });

          for (const toolCall of parsed.toolCalls) {
            const tc: ToolCall = { id: toolCall.id, function: { name: toolCall.function.name, arguments: toolCall.function.arguments } };
            const args = JSON.parse(tc.function.arguments);

            this.postMessage({ type: 'toolCall', name: tc.function.name, args: this.formatToolCall(tc.function.name, args) });

            lastToolName = tc.function.name;
            toolsUsed.push(tc.function.name);
            if (tc.function.name === 'read_file') filesRead.add(args.path);
            if (tc.function.name === 'write_file' || tc.function.name === 'edit_file') filesModified.add(args.path);

            const result = await executeTool(tc);
            this.postMessage({ type: 'toolResult', name: tc.function.name, result: result.length > 2000 ? result.substring(0, 2000) + '\n...' : result });

            const historyResult = result.length > 4000 ? result.substring(0, 4000) + '\n... (truncated)' : result;
            this.conversationHistory.push({ role: 'tool', content: historyResult, tool_call_id: tc.id });
          }

          if (iteration > 1 && iteration % 5 === 0) {
            this.postMessage({ type: 'stream', text: this.buildProgressSummary(iteration, toolsUsed, filesRead, filesModified) });
          }
        } else {
          // ---- Final response (already streamed to UI) ----
          if (iteration > 1) {
            this.postMessage({ type: 'stream', text: this.buildProgressSummary(iteration - 1, toolsUsed, filesRead, filesModified) });
          }

          needsMoreToolCalls = false;
          // Content was already streamed token-by-token; now save to history
          if (parsed.content) {
            this.postMessage({ type: 'assistantDone' });
            this.conversationHistory.push({ role: 'assistant', content: parsed.content });
          }
        }
      }

      // Festive summary for long tasks (>50 steps)
      if (iteration > 50) {
        const summary = this.buildFestiveSummary(iteration, toolsUsed, filesRead, filesModified);
        this.postMessage({ type: 'festiveSummary', html: summary });
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

  /**
   * Parse SSE streaming response. Streams content tokens to the webview in real-time.
   * Accumulates tool_calls silently. Returns the complete parsed result.
   */
  private async parseSSEResponse(response: Response): Promise<{
    content: string;
    toolCalls: any[];
    finishReason: string;
    usage: any;
    /** true if content was already streamed to the UI token-by-token */
    wasStreamed: boolean;
  }> {
    let content = '';
    const toolCallsMap = new Map<number, { id: string; function: { name: string; arguments: string } }>();
    let finishReason = '';
    let usage: any = null;
    let isStreaming = false;
    let wasStreamed = false;

    const body = response.body;
    if (!body) {
      // Fallback: non-streaming response (e.g. fallback requests)
      const data = await response.json() as any;
      const choice = data.choices?.[0];
      return {
        content: choice?.message?.content || '',
        toolCalls: choice?.message?.tool_calls || [],
        finishReason: choice?.finish_reason || '',
        usage: data.usage || null,
        wasStreamed: false
      };
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta;
            const fr = json.choices?.[0]?.finish_reason;
            if (fr) finishReason = fr;
            if (json.usage) usage = json.usage;

            if (delta?.content) {
              content += delta.content;
              // Stream content tokens to UI in real-time (only if no tool calls detected yet)
              if (toolCallsMap.size === 0 && finishReason !== 'tool_calls') {
                if (!isStreaming) {
                  isStreaming = true;
                  wasStreamed = true;
                  this.postMessage({ type: 'streamStart' });
                }
                this.postMessage({ type: 'stream', text: delta.content });
              }
            }

            // Accumulate tool_calls deltas
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallsMap.has(idx)) {
                  toolCallsMap.set(idx, { id: tc.id || '', function: { name: '', arguments: '' } });
                }
                const entry = toolCallsMap.get(idx)!;
                if (tc.id) entry.id = tc.id;
                if (tc.function?.name) entry.function.name += tc.function.name;
                if (tc.function?.arguments) entry.function.arguments += tc.function.arguments;
              }
            }
          } catch { /* skip malformed SSE lines */ }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      content,
      toolCalls: [...toolCallsMap.values()],
      finishReason,
      usage,
      wasStreamed
    };
  }

  private buildProgressSummary(iteration: number, toolsUsed: string[], filesRead: Set<string>, filesModified: Set<string>): string {
    const parts: string[] = [`*Progress: ${iteration} steps completed.*`];
    if (filesRead.size > 0) parts.push(`Files read: ${[...filesRead].slice(-5).join(', ')}`);
    if (filesModified.size > 0) parts.push(`Files modified: ${[...filesModified].join(', ')}`);
    const searches = toolsUsed.filter(t => t === 'web_search' || t === 'search_files').length;
    const commands = toolsUsed.filter(t => t === 'run_terminal').length;
    if (searches > 0) parts.push(`Searches: ${searches}`);
    if (commands > 0) parts.push(`Commands run: ${commands}`);
    return parts.join(' | ') + '\n';
  }

  private buildFestiveSummary(iteration: number, toolsUsed: string[], filesRead: Set<string>, filesModified: Set<string>): string {
    const searches = toolsUsed.filter(t => t === 'web_search' || t === 'search_files').length;
    const commands = toolsUsed.filter(t => t === 'run_terminal').length;
    const reads = toolsUsed.filter(t => t === 'read_file').length;
    const edits = toolsUsed.filter(t => t === 'edit_file' || t === 'write_file').length;

    let html = '<div class="festive-summary">';
    html += '<div class="festive-header">ðŸŽ‰ðŸ† <b>Task Complete!</b> ðŸ†ðŸŽ‰</div>';
    html += '<div class="festive-stats">';
    html += `<div class="stat">âš¡ <b>${iteration}</b> steps executed</div>`;
    html += `<div class="stat">ðŸ“– <b>${reads}</b> files read Â· ðŸ“ <b>${filesRead.size}</b> unique</div>`;
    html += `<div class="stat">âœï¸ <b>${edits}</b> edits made Â· ðŸ“ <b>${filesModified.size}</b> files modified</div>`;
    if (commands > 0) html += `<div class="stat">ðŸ–¥ï¸ <b>${commands}</b> commands run</div>`;
    if (searches > 0) html += `<div class="stat">ðŸ” <b>${searches}</b> searches performed</div>`;
    html += '</div>';
    html += '<div class="festive-footer">ðŸš€âœ¨ <i>Excellent work! Ready for the next challenge.</i> âœ¨ðŸš€</div>';
    html += '</div>';
    return html;
  }

  private friendlyToolName(name: string): string {
    switch (name) {
      case 'read_file': return 'reading file';
      case 'write_file': return 'writing file';
      case 'edit_file': return 'editing file';
      case 'run_terminal': return 'running command';
      case 'search_files': return 'searching code';
      case 'list_files': return 'listing files';
      case 'find_files': return 'finding files';
      case 'get_diagnostics': return 'checking diagnostics';
      case 'read_image': return 'analyzing image';
      case 'web_search': return 'web search';
      case 'fetch_url': return 'fetching page';
      default: return name;
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
          this.postMessage({ type: 'stream', text: '*(Message queued â€” will be incorporated in the next step)*\n' });
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
      case 'copyCode':
        await vscode.env.clipboard.writeText(message.code);
        break;
      case 'exportChat': {
        const md = this.conversationHistory
          .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content && !m.tool_calls)
          .map(m => m.role === 'user' ? `## User\n\n${m.content}` : `## MiMo\n\n${m.content}`)
          .join('\n\n---\n\n');
        const doc = await vscode.workspace.openTextDocument({ content: `# MiMo Chat Export\n\n${md}`, language: 'markdown' });
        await vscode.window.showTextDocument(doc);
        break;
      }
      case 'setModel':
        await vscode.workspace.getConfiguration('mimo').update('preferredModel', message.model, vscode.ConfigurationTarget.Workspace);
        this.postMessage({ type: 'stream', text: `*Model set to ${message.model}*\n` });
        break;
      case 'fetchModels': {
        const models = await fetchModelsFromApi();
        const options = getModelOptions();
        this.postMessage({ type: 'modelsLoaded', models: options });
        break;
      }
      case 'attachImage': {
        // Store image data in conversation history for multimodal models
        if (message.dataUrl) {
          this.conversationHistory.push({
            role: 'user',
            content: message.caption || '[Image pasted from clipboard]'
          });
          // Store image reference for next API call
          this._pendingImages = this._pendingImages || [];
          this._pendingImages.push(message.dataUrl);
          this.postMessage({ type: 'imageAttached', preview: message.dataUrl.substring(0, 80) });
        }
        break;
      }
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
        <select id="modelSelect" class="toolbar-select" title="Select model">
          <option value="auto">Auto</option>
          <option value="mimo-v2-pro">Pro</option>
          <option value="mimo-v2-flash">Flash</option>
        </select>
        <button id="exportBtn" class="toolbar-btn" title="Export as Markdown">Export</button>
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
