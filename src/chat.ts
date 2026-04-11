import * as vscode from 'vscode';
import { TOOLS, WEB_SEARCH_TOOL, LOCAL_WEB_TOOLS, executeTool, ToolCall } from './tools';
import { buildSystemPrompt, invalidatePromptCache } from './prompt';
import { ChatMessage, compressHistory } from './context';
import { pickModel, getModel, getApiConfig } from './provider';

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
            content: `⚠️ PUNTO DE CONTROL: Llevas ${iteration - 1} iteraciones. Antes de continuar, haz un resumen rápido de:
1. Qué has hecho hasta ahora
2. Qué falta por hacer
3. Si estás en un bucle o estancado, dilo claramente
Continúa después del resumen.`
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

        // Only think on first iteration and at checkpoints — fast mode for tool calls
        const useThinking = modelSpec.supportsThinking && (iteration === 1 || iteration % CHECKPOINT_INTERVAL === 0);

        const requestBody: Record<string, any> = {
          model: modelId,
          messages,
          tools: vscode.workspace.getConfiguration('mimo').get('webSearch') ? [...TOOLS, WEB_SEARCH_TOOL] : [...TOOLS, ...LOCAL_WEB_TOOLS],
          stream: false,
          max_completion_tokens: Math.min(modelSpec.maxOutputTokens, 32768),
          temperature: modelId === 'mimo-v2-flash' ? 0.3 : 0.5
        };

        requestBody.thinking = { type: useThinking ? 'enabled' : 'disabled' };

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

        if (!response.ok) {
          const errorText = await response.text();
          if (errorText.includes('web_search') || errorText.includes('plugin')) {
            stream.markdown(`**Web Search plugin not enabled.** Enable it at [platform.xiaomimimo.com](https://platform.xiaomimimo.com) > Plugin Management.\n\n${errorText}`);
          } else {
            stream.markdown(`**Error** (${response.status}): ${errorText}`);
          }
          return;
        }

        const data = await response.json() as any;
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
            const tc: ToolCall = {
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
            lastToolName = tc.function.name;
            const result = await executeTool(tc);

            // Show abbreviated result
            const displayResult = result.length > 500
              ? result.substring(0, 500) + '\n... (ver resultado completo en el historial)'
              : result;
            stream.markdown(`\`\`\`\n${displayResult}\n\`\`\`\n`);

            // Add tool result to history
            this.conversationHistory.push({
              role: 'tool',
              content: result.length > 4000 ? result.substring(0, 4000) + '\n... (truncated)' : result,
              tool_call_id: tc.id
            });
          }
        } else {
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

    } catch (error: any) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        stream.markdown('❌ **Timeout**: La conexión con MiMo tardó más de 120 segundos.');
      } else {
        stream.markdown(`❌ **Error**: ${error.message}`);
      }
    }
  }

  private formatToolCall(name: string, args: any): string {
    switch (name) {
      case 'read_file': return `read ${args.path}${args.offset ? ':' + args.offset : ''}`;
      case 'write_file': return `write ${args.path} (${args.content?.length || 0} chars)`;
      case 'edit_file': return `edit ${args.path}${args.replace_all ? ' (all)' : ''}`;
      case 'run_terminal': return `$ ${args.command}`;
      case 'search_files': return `search "${args.pattern}"${args.glob ? ' in ' + args.glob : ''}`;
      case 'list_files': return `ls ${args.path || '.'}${args.recursive ? ' -R' : ''}`;
      case 'find_files': return `find ${args.pattern}`;
      case 'get_diagnostics': return `diagnostics ${args.path || 'all'}`;
      default: return `${name}(${JSON.stringify(args)})`;
    }
  }

  clearHistory(): void {
    this.conversationHistory = [];
    invalidatePromptCache();
  }
}
