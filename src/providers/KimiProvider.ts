/**
 * Kimi Provider - Moonshot AI
 * High-reasoning model for architecture and planning
 */

import * as vscode from 'vscode';
import { AICodingProvider, AIModel, ChatMessage, ChatOptions, ChatChunk, ProviderConfig } from './BaseProvider';

const KIMI_MODELS: AIModel[] = [
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6',
    family: 'kimi',
    maxInputTokens: 262144,
    maxOutputTokens: 32000,
    description: 'Moonshot Kimi K2.6 — trillion parameter reasoning model',
    capabilities: {
      imageInput: true,
      toolCalling: true,
      streaming: true
    }
  }
];

// Cost per 1M tokens in USD
const KIMI_COSTS = {
  'kimi-k2.6': { input: 0.95, output: 4.0, cacheRead: 0.16, cacheWrite: 0.95 }
};

interface KimiRequestBody {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  max_tokens?: number;
  temperature?: number;
  tools?: any[];
}

export class KimiProvider implements AICodingProvider {
  readonly name = 'kimi';
  readonly displayName = 'Moonshot Kimi';
  readonly models = KIMI_MODELS;

  private getConfig(): ProviderConfig {
    const config = vscode.workspace.getConfiguration('kimi');
    const inspectKey = config.inspect<string>('apiKey');
    const inspectUrl = config.inspect<string>('baseUrl');
    return {
      apiKey: inspectKey?.workspaceValue || inspectKey?.globalValue || '',
      baseUrl: inspectUrl?.workspaceValue || inspectUrl?.globalValue || 'https://api.moonshot.cn/v1',
      timeout: 120000
    };
  }

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
      throw new Error('Kimi API Key no configurada. Usa el comando "Kimi: Configure API Key".');
    }

    const body: KimiRequestBody = {
      model: options.model,
      messages: options.messages,
      stream: options.stream ?? true,
      max_tokens: options.maxTokens,
      temperature: options.temperature ?? 0.7
    };

    if (options.tools) {
      body.tools = options.tools.map(t => ({
        type: 'function',
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters
        }
      }));
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
      throw new Error(`Kimi API error ${response.status}: ${errorText}`);
    }

    if (!options.stream) {
      const data = await response.json() as any;
      yield {
        content: data.choices?.[0]?.message?.content || '',
        done: true
      };
      return;
    }

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
                id: tc.id,
                function: {
                  name: tc.function?.name,
                  arguments: tc.function?.arguments
                }
              }))
            };
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    yield { content: '', done: true };
  }

  estimateCost(inputTokens: number, outputTokens: number, modelId: string): number {
    const costs = KIMI_COSTS[modelId as keyof typeof KIMI_COSTS];
    if (!costs) return 0;
    return (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;
  }

  countTokens(text: string): number {
    // Kimi uses ~4 chars per token for mixed content
    return Math.ceil(text.length / 4);
  }
}
