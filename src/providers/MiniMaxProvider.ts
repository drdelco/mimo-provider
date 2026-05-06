/**
 * MiniMax Provider — OpenAI-compatible chat completions API.
 *
 * Uses the same `mimo.minimaxApiKey` / `mimo.minimaxBaseUrl` settings that
 * the single-agent MiMoProvider uses, so users only configure once.
 *
 * Default model: MiniMax-M1 (long-context reasoning model).
 */

import * as vscode from 'vscode';
import { AICodingProvider, AIModel, ChatMessage, ChatOptions, ChatChunk, ProviderConfig } from './BaseProvider';

const MINIMAX_MODELS: AIModel[] = [
  {
    id: 'MiniMax-M1',
    name: 'MiniMax M1',
    family: 'minimax',
    maxInputTokens: 1_000_000,
    maxOutputTokens: 40_000,
    description: 'MiniMax M1 — 1M context reasoning model',
    capabilities: {
      imageInput: false,
      toolCalling: true,
      streaming: true
    }
  }
];

// Cost per 1M tokens in USD (approximate; MiniMax often free tier or near-free)
const MINIMAX_COSTS: Record<string, { input: number; output: number }> = {
  'MiniMax-M1': { input: 0.40, output: 2.20 }
};

interface MiniMaxRequestBody {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  max_tokens?: number;
  temperature?: number;
  tools?: any[];
}

export class MiniMaxProvider implements AICodingProvider {
  readonly name = 'minimax';
  readonly displayName = 'MiniMax';
  readonly models = MINIMAX_MODELS;

  private getConfig(): ProviderConfig {
    const config = vscode.workspace.getConfiguration('mimo');
    const inspectKey = config.inspect<string>('minimaxApiKey');
    const inspectUrl = config.inspect<string>('minimaxBaseUrl');
    return {
      apiKey: inspectKey?.workspaceValue || inspectKey?.globalValue || '',
      baseUrl: inspectUrl?.workspaceValue || inspectUrl?.globalValue || 'https://api.minimax.io/v1',
      timeout: 120000
    };
  }

  async isAvailable(): Promise<boolean> {
    const config = this.getConfig();
    if (!config.apiKey) return false;
    try {
      // MiniMax uses OpenAI-compatible /models endpoint
      const response = await fetch(`${config.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(10000)
      });
      // Some endpoints return 404 for /models but accept /chat/completions —
      // treat 404 as "configured" (we'll find out on first chat call)
      return response.ok || response.status === 404;
    } catch {
      return false;
    }
  }

  async *chat(options: ChatOptions): AsyncGenerator<ChatChunk, void, unknown> {
    const config = this.getConfig();
    if (!config.apiKey) {
      throw new Error('MiniMax API Key not configured.');
    }

    const body: MiniMaxRequestBody = {
      model: options.model,
      messages: options.messages,
      stream: options.stream ?? true,
      max_tokens: options.maxTokens,
      temperature: options.temperature ?? 0.7
    };

    if (options.tools && options.tools.length > 0) {
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
      throw new Error(`MiniMax API error ${response.status}: ${errorText}`);
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
          // Skip malformed JSON
        }
      }
    }

    yield { content: '', done: true };
  }

  estimateCost(inputTokens: number, outputTokens: number, modelId: string): number {
    const costs = MINIMAX_COSTS[modelId];
    if (!costs) return 0;
    return (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
