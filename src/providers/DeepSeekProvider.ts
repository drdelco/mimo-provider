/**
 * DeepSeek Provider
 * Cost-effective coding model with excellent reasoning
 */

import * as vscode from 'vscode';
import { AICodingProvider, AIModel, ChatMessage, ChatOptions, ChatChunk, ProviderConfig } from './BaseProvider';

const DEEPSEEK_MODELS: AIModel[] = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    family: 'deepseek',
    maxInputTokens: 1048576,
    maxOutputTokens: 384000,
    description: 'DeepSeek V4 Flash — fast and cost-effective',
    capabilities: {
      imageInput: false,
      toolCalling: true,
      streaming: true
    }
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    family: 'deepseek',
    maxInputTokens: 1048576,
    maxOutputTokens: 384000,
    description: 'DeepSeek V4 Pro — advanced reasoning',
    capabilities: {
      imageInput: false,
      toolCalling: true,
      streaming: true
    }
  }
];

// Cost per 1M tokens in USD
const DEEPSEEK_COSTS = {
  'deepseek-v4-flash': { input: 0.14, output: 0.28, cacheRead: 0.028, cacheWrite: 0.14 },
  'deepseek-v4-pro': { input: 1.74, output: 3.48, cacheRead: 0.145, cacheWrite: 1.74 }
};

interface DeepSeekRequestBody {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  max_tokens?: number;
  temperature?: number;
  tools?: any[];
}

export class DeepSeekProvider implements AICodingProvider {
  readonly name = 'deepseek';
  readonly displayName = 'DeepSeek';
  readonly models = DEEPSEEK_MODELS;

  private getConfig(): ProviderConfig {
    const config = vscode.workspace.getConfiguration('deepseek');
    const inspectKey = config.inspect<string>('apiKey');
    const inspectUrl = config.inspect<string>('baseUrl');
    return {
      apiKey: inspectKey?.workspaceValue || inspectKey?.globalValue || '',
      baseUrl: inspectUrl?.workspaceValue || inspectUrl?.globalValue || 'https://api.deepseek.com/v1',
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
      throw new Error('DeepSeek API Key no configurada.');
    }

    const body: DeepSeekRequestBody = {
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
      throw new Error(`DeepSeek API error ${response.status}: ${errorText}`);
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
                function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' }
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
    const costs = DEEPSEEK_COSTS[modelId as keyof typeof DEEPSEEK_COSTS];
    if (!costs) return 0;
    return (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
