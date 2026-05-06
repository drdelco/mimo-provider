/**
 * MiMo Provider - Refactored to implement AICodingProvider
 * Maintains backward compatibility with vscode.LanguageModelChatProvider
 */

import * as vscode from 'vscode';
import { AICodingProvider, AIModel, ChatMessage, ChatOptions, ChatChunk, ProviderConfig } from './BaseProvider';

const MIMO_MODELS: AIModel[] = [
  {
    id: 'mimo-v2-pro',
    name: 'MiMo V2 Pro',
    family: 'mimo',
    maxInputTokens: 262144,
    maxOutputTokens: 8192,
    description: 'Xiaomi MiMo V2 Pro — razonamiento avanzado',
    capabilities: {
      imageInput: false,
      toolCalling: true,
      streaming: true
    }
  },
  {
    id: 'mimo-v2-flash',
    name: 'MiMo V2 Flash',
    family: 'mimo',
    maxInputTokens: 262144,
    maxOutputTokens: 8192,
    description: 'Xiaomi MiMo V2 Flash — rápido y eficiente',
    capabilities: {
      imageInput: false,
      toolCalling: true,
      streaming: true
    }
  }
];

interface MiMoRequestBody {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  max_tokens?: number;
  temperature?: number;
  tools?: any[];
}

export class MiMoProvider implements AICodingProvider, vscode.LanguageModelChatProvider {
  readonly name = 'mimo';
  readonly displayName = 'Xiaomi MiMo';
  readonly models = MIMO_MODELS;

  private getConfig(): ProviderConfig {
    const config = vscode.workspace.getConfiguration('mimo');
    const inspectKey = config.inspect<string>('apiKey');
    const inspectUrl = config.inspect<string>('baseUrl');
    return {
      apiKey: inspectKey?.workspaceValue || inspectKey?.globalValue || '',
      baseUrl: inspectUrl?.workspaceValue || inspectUrl?.globalValue || 'https://token-plan-ams.xiaomimimo.com/v1',
      timeout: 120000
    };
  }

  // --- AICodingProvider Implementation ---

  async isAvailable(): Promise<boolean> {
    const config = this.getConfig();
    if (!config.apiKey) return false;
    
    try {
      const response = await fetch(`${config.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(10000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async *chat(options: ChatOptions): AsyncGenerator<ChatChunk, void, unknown> {
    const config = this.getConfig();
    if (!config.apiKey) {
      throw new Error('MiMo API Key no configurada.');
    }

    const body: MiMoRequestBody = {
      model: options.model,
      messages: options.messages,
      stream: options.stream ?? true,
      max_tokens: options.maxTokens,
      temperature: options.temperature ?? 0.7
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeout || 120000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MiMo API error ${response.status}: ${errorText}`);
    }

    if (!options.stream) {
      const data = await response.json() as any;
      const msg = data.choices?.[0]?.message;
      yield {
        content: msg?.content || '',
        done: true,
        toolCalls: msg?.tool_calls
      };
      return;
    }

    // Streaming
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          yield { content: '', done: true };
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            yield { content: delta.content, done: false };
          }
          if (delta?.tool_calls) {
            yield {
              content: '',
              done: false,
              toolCalls: delta.tool_calls.map((tc: any) => ({
                id: tc.id || '',
                index: typeof tc.index === 'number' ? tc.index : undefined,
                function: {
                  name: tc.function?.name || '',
                  arguments: tc.function?.arguments || ''
                }
              }))
            };
          }
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }

    yield { content: '', done: true };
  }

  estimateCost(inputTokens: number, outputTokens: number, modelId: string): number {
    // MiMo Token Plan is free (0 cost)
    return 0;
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  // --- VS Code LanguageModelChatProvider (Backward Compatibility) ---

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const available = await this.isAvailable();
    
    if (!available) {
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

    return this.models.map(model => ({
      id: model.id,
      name: model.name,
      family: model.family,
      version: '2.0.0',
      maxInputTokens: model.maxInputTokens,
      maxOutputTokens: model.maxOutputTokens,
      tooltip: model.description,
      detail: `Xiaomi · ${model.maxInputTokens.toLocaleString()} tokens`,
      capabilities: {
        imageInput: model.capabilities.imageInput,
        toolCalling: model.capabilities.toolCalling
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
    const convertedMessages = this.convertVSCodeMessages(messages);
    
    const stream = this.chat({
      model: model.id,
      messages: convertedMessages,
      stream: true,
      maxTokens: Math.min(model.maxOutputTokens, 8192),
      temperature: 0.7
    });

    for await (const chunk of stream) {
      if (token.isCancellationRequested) break;
      if (chunk.content) {
        progress.report(new vscode.LanguageModelTextPart(chunk.content));
      }
      if (chunk.done) break;
    }
  }

  async provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    input: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken
  ): Promise<number> {
    if (typeof input === 'string') {
      return this.countTokens(input);
    }

    let total = 0;
    for (const part of input.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        total += this.countTokens(part.value);
      } else {
        total += 100;
      }
    }
    return total;
  }

  private convertVSCodeMessages(
    messages: readonly vscode.LanguageModelChatRequestMessage[]
  ): ChatMessage[] {
    return messages.map((msg): ChatMessage => {
      const role: 'user' | 'assistant' = msg.role === vscode.LanguageModelChatMessageRole.User ? 'user' : 'assistant';
      const textParts: string[] = [];

      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          textParts.push(part.value);
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          textParts.push(`[Tool Call: ${part.name}]`);
        } else if (part instanceof vscode.LanguageModelToolResultPart) {
          textParts.push(`[Tool Result]`);
        }
      }

      return { role, content: textParts.join('\n') };
    }).filter(msg => msg.content);
  }
}
