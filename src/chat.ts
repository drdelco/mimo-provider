import * as vscode from 'vscode';
import { TOOLS, WEB_SEARCH_TOOL, LOCAL_WEB_TOOLS, executeTool, ToolCall, containsWebSearchXml, executeWebSearchFromXml } from './tools';
import { buildSystemPrompt, invalidatePromptCache } from './prompt';
import { ChatMessage, compressHistory } from './context';
import { pickModel, getModel, getApiConfig, getApiConfigForModel, markModelSuccess, markModelFailed, getFallbackChain } from './provider';

export class MiMoChatParticipant {
  private conversationHistory: ChatMessage[] = [];

  register(context: vscode.ExtensionContext): vscode.ChatParticipant {
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

  private async handleRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    const { apiKey, baseUrl } = getApiConfig();
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

    // Add to conversation history and compress if needed
    this.conversationHistory.push({ role: 'user', content: userMessage });
    this.conversationHistory = compressHistory(this.conversationHistory);

    const maxIterations = 500; // Safety cap only
    const CHECKPOINT_INTERVAL = 10; // Force progress summary every N iterations

    try {
      let iteration = 0;
      let needsMoreToolCalls = true;
      let lastToolName: string | undefined;

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
            content: `⚠️ PUNTO DE CONTROL: Llevas ${iteration} pasos. Resume brevemente: 1) qué has hecho 2) qué queda 3) si estás atascado, dilo claramente. Luego continúa.`
          });
        }

        if (iteration === 1) {
          stream.progress('Pensando...');
        } else {
          stream.progress(`Ejecutando herramienta (${iteration})...`);
        }

        // Build messages array
        const messages = [
          { role: 'system', content: buildSystemPrompt() },
          ...this.conversationHistory
        ];

        // Smart model selection
        const modelId = pickModel(false, lastToolName);
        const modelSpec = getModel(modelId);

        const isDeepSeek = modelId.startsWith('deepseek');
        const isMiniMax = modelId.startsWith('MiniMax') || modelId.startsWith('minimax');
        // Providers without native $web_search: DeepSeek, MiniMax
        const needsDuckDuckGo = isDeepSeek || isMiniMax;

        // Only think on first iteration and at checkpoints — fast mode for tool calls
        const useThinking = modelSpec.supportsThinking && (iteration === 1 || iteration % CHECKPOINT_INTERVAL === 0);

        const useXiaomiSearch = vscode.workspace.getConfiguration('mimo').get('webSearch');
        // Xiaomi/Kimi builtin_function ($web_search) is not compatible with DeepSeek or MiniMax
        const tools = needsDuckDuckGo
          ? [...TOOLS, ...LOCAL_WEB_TOOLS]
          : (useXiaomiSearch ? [...TOOLS, ...LOCAL_WEB_TOOLS, WEB_SEARCH_TOOL] : [...TOOLS, ...LOCAL_WEB_TOOLS]);
        const requestBody: Record<string, any> = {
          model: modelId,
          messages,
          tools,
          stream: false,
          max_completion_tokens: Math.min(modelSpec.maxOutputTokens, 32768),
          temperature: modelId === 'mimo-v2-flash' ? 0.3 : 0.5
        };

        if (!needsDuckDuckGo) {
          requestBody.thinking = { type: useThinking ? 'enabled' : 'disabled' };
        }

        let response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(300000)
        });

        // Fallback: if Flash fails (not in plan), retry with Pro
        if (!response.ok && modelId === 'mimo-v2-flash') {
          const fallbackSpec = getModel('mimo-v2-pro');
          requestBody.model = 'mimo-v2-pro';
          requestBody.max_completion_tokens = Math.min(fallbackSpec.maxOutputTokens, 32768);
          requestBody.thinking = { type: 'enabled' };
          response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(300000)
          });
        }

        // Web search fallback: if Xiaomi/Kimi plugin fails, retry with DuckDuckGo
        if (!response.ok && useXiaomiSearch) {
          const errDetail = await response.text().catch(() => '');
          stream.markdown(`*$web_search failed (${response.status}: ${errDetail.substring(0, 100)}) — switching to DuckDuckGo...*\n\n`);
          requestBody.tools = [...TOOLS, ...LOCAL_WEB_TOOLS];
          response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
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
            const fbConfig = getApiConfigForModel(fallbackId);
            const fbIsDeepSeek = fallbackId.startsWith('deepseek');
            const fbIsMiniMax = fallbackId.startsWith('MiniMax') || fallbackId.startsWith('minimax');
            const fbNeedsDuckDuckGo = fbIsDeepSeek || fbIsMiniMax;

            stream.markdown(`*Model ${modelId} failed (${response.status}) — trying ${fallbackId}...*\n\n`);

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
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${fbConfig.apiKey}`
              },
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
            stream.markdown(`**Error** — all models failed. Last error (${response.status}): ${errorText}`);
            return;
          }
        } else {
          markModelSuccess(modelId);
        }

        const data = await response.json() as any;
        const choice = data.choices?.[0];
        if (!choice) {
          stream.markdown('❌ No se recibió respuesta válida de MiMo.');
          return;
        }

        const message = choice.message;

        // $web_search XML handling — MiMo returns search as XML in content
        if (message.content && message.finish_reason === 'tool_calls' && containsWebSearchXml(message.content)) {
          stream.markdown('🔍 *Searching the web...*\n\n');
          const searchResult = await executeWebSearchFromXml(message.content);
          if (searchResult) {
            stream.markdown(`**Web search:** ${searchResult.query}\n\n`);
            this.conversationHistory.push({ role: 'assistant', content: message.content });
            this.conversationHistory.push({ role: 'user', content: `[Web search results for: ${searchResult.query}]\n\n${searchResult.results}` });
            continue;
          }
        }

        // Handle tool calls
        if (message.tool_calls && message.tool_calls.length > 0) {
          // Show any intermediate text from MiMo
          if (message.content) {
            stream.markdown(message.content + '\n\n');
          }

          this.conversationHistory.push({ role: 'assistant', content: message.content || '', tool_calls: message.tool_calls });

          for (const toolCall of message.tool_calls) {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments || '{}');

            stream.markdown(`🔧 *${toolName}*\n\n`);

            try {
              const tc: ToolCall = { id: toolCall.id, function: { name: toolName, arguments: JSON.stringify(toolArgs) } };
              const result = await executeTool(tc);
              const resultText = typeof result === 'string' ? result : JSON.stringify(result);

              this.conversationHistory.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: resultText
              });

              lastToolName = toolName;
            } catch (err: any) {
              this.conversationHistory.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Error: ${err.message}`
              });
            }
          }

          needsMoreToolCalls = true;
        } else {
          // No tool calls — we're done
          if (message.content) {
            stream.markdown(message.content);
          }
          this.conversationHistory.push({ role: 'assistant', content: message.content || '' });
          needsMoreToolCalls = false;
        }
      }
    } catch (err: any) {
      stream.markdown(`\n\n❌ **Error:** ${err.message}`);
    }
  }
}
