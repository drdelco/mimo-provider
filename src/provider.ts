import * as vscode from 'vscode';

interface MiMoModel {
  id: string;
  name: string;
  family: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  description: string;
}

const MIMO_MODELS: MiMoModel[] = [
  {
    id: 'mimo-v2-pro',
    name: 'MiMo V2 Pro',
    family: 'mimo',
    maxInputTokens: 262144,
    maxOutputTokens: 8192,
    description: 'Xiaomi MiMo V2 Pro — razonamiento avanzado'
  },
  {
    id: 'mimo-v2-flash',
    name: 'MiMo V2 Flash',
    family: 'mimo',
    maxInputTokens: 262144,
    maxOutputTokens: 8192,
    description: 'Xiaomi MiMo V2 Flash — rápido y eficiente'
  }
];

interface MiMoMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface MiMoRequestBody {
  model: string;
  messages: MiMoMessage[];
  stream: boolean;
  max_tokens?: number;
  temperature?: number;
}

export class MiMoProvider implements vscode.LanguageModelChatProvider {

  private getApiKey(): string {
    // Read from workspace first, then fall back to user/global settings
    const config = vscode.workspace.getConfiguration('mimo');
    const inspect = config.inspect<string>('apiKey');
    return inspect?.workspaceValue || inspect?.globalValue || '';
  }

  private getBaseUrl(): string {
    const config = vscode.workspace.getConfiguration('mimo');
    const inspect = config.inspect<string>('baseUrl');
    return inspect?.workspaceValue || inspect?.globalValue || 'https://token-plan-ams.xiaomimimo.com/v1';
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const apiKey = this.getApiKey();

    if (!apiKey) {
      if (!options.silent) {
        const action = await vscode.window.showInformationMessage(
          'MiMo: Configura tu API Key para usar los modelos MiMo.',
          'Configurar'
        );
        if (action === 'Configurar') {
          await vscode.commands.executeCommand('mimo.manage');
        }
      }
      return [];
    }

    return MIMO_MODELS.map(model => ({
      id: model.id,
      name: model.name,
      family: model.family,
      version: '2.0.0',
      maxInputTokens: model.maxInputTokens,
      maxOutputTokens: model.maxOutputTokens,
      tooltip: model.description,
      detail: `Xiaomi · ${model.maxInputTokens.toLocaleString()} tokens`,
      capabilities: {
        imageInput: false,
        toolCalling: true
      }
    }));
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('MiMo API Key no configurada. Usa el comando "MiMo: Configure API Key".');
    }

    const baseUrl = this.getBaseUrl();
    const convertedMessages = this.convertMessages(messages);

    const body: MiMoRequestBody = {
      model: model.id,
      messages: convertedMessages,
      stream: true,
      max_tokens: Math.min(model.maxOutputTokens, 8192),
      temperature: 0.7
    };

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`MiMo API error ${response.status}: ${errorText}`);
      }

      // Process SSE stream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        if (token.isCancellationRequested) {
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              progress.report(new vscode.LanguageModelTextPart(content));
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        throw new Error('MiMo: Timeout de conexión (120s). Verifica tu API Key y conexión.');
      }
      throw error;
    }
  }

  async provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    input: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken
  ): Promise<number> {
    // Simple estimation: ~4 chars per token for Chinese/English mixed content
    if (typeof input === 'string') {
      return Math.ceil(input.length / 4);
    }

    let total = 0;
    for (const part of input.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        total += Math.ceil(part.value.length / 4);
      } else {
        // Tool calls/results estimated at ~100 tokens
        total += 100;
      }
    }
    return total;
  }

  private convertMessages(
    messages: readonly vscode.LanguageModelChatRequestMessage[]
  ): MiMoMessage[] {
    const result: MiMoMessage[] = [];

    for (const msg of messages) {
      const role = msg.role === vscode.LanguageModelChatMessageRole.User
        ? 'user'
        : 'assistant';

      // Extract text content from parts
      const textParts: string[] = [];
      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          textParts.push(part.value);
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          // Convert tool calls to text representation
          textParts.push(`[Tool Call: ${part.name}]`);
        } else if (part instanceof vscode.LanguageModelToolResultPart) {
          textParts.push(`[Tool Result]`);
        }
      }

      const content = textParts.join('\n');
      if (content) {
        result.push({ role, content });
      }
    }

    return result;
  }
}
