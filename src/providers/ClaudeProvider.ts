/**
 * Claude Provider - Anthropic
 * Best-in-class for code review, security analysis, and complex reasoning
 */

import * as vscode from 'vscode';
import { AICodingProvider, AIModel, ChatMessage, ChatOptions, ChatChunk, ProviderConfig } from './BaseProvider';

const CLAUDE_MODELS: AIModel[] = [
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    family: 'claude',
    maxInputTokens: 200000,
    maxOutputTokens: 8192,
    description: 'Anthropic Claude Sonnet 4 — balanced performance',
    capabilities: {
      imageInput: true,
      toolCalling: true,
      streaming: true
    }
  }
];

// Cost per 1M tokens in USD (approximate, check Anthropic for current pricing)
const CLAUDE_COSTS = {
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 }
};

interface ClaudeRequestBody {
  model: string;
  messages: { role: string; content: string }[];
  max_tokens: number;
  temperature?: number;
  stream?: boolean;
  tools?: any[];
  system?: string;
}

export class ClaudeProvider implements AICodingProvider {
  readonly name = 'claude';
  readonly displayName = 'Anthropic Claude';
  readonly models = CLAUDE_MODELS;

  private getConfig(): ProviderConfig {
    const config = vscode.workspace.getConfiguration('claude');
    const inspectKey = config.inspect<string>('apiKey');
    const inspectUrl = config.inspect<string>('baseUrl');
    return {
      apiKey: inspectKey?.workspaceValue || inspectKey?.globalValue || '',
      baseUrl: inspectUrl?.workspaceValue || inspectUrl?.globalValue || 'https://api.anthropic.com/v1',
      timeout: 120000
    };
  }

  async isAvailable(): Promise<boolean> {
    const config = this.getConfig();
    if (!config.apiKey) return false;
    
    try {
      const response = await fetch(`${config.baseUrl}/models`, {
        headers: { 
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01'
        },
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
      throw new Error('Claude API Key no configurada.');
    }

    // Extract system message if present
    const systemMessage = options.messages.find(m => m.role === 'system');
    const conversationMessages = options.messages.filter(m => m.role !== 'system');

    const body: ClaudeRequestBody = {
      model: options.model,
      messages: conversationMessages.map(m => ({
        role: m.role,
        content: m.content
      })),
      max_tokens: options.maxTokens || 8192,
      temperature: options.temperature ?? 0.7,
      stream: options.stream ?? true
    };

    if (systemMessage) {
      body.system = systemMessage.content;
    }

    if (options.tools) {
      body.tools = options.tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters
      }));
    }

    const response = await fetch(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeout || 120000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error ${response.status}: ${errorText}`);
    }

    if (!options.stream) {
      const data = await response.json();
      yield {
        content: data.content?.[0]?.text || '',
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
          const type = parsed.type;

          if (type === 'content_block_delta') {
            const text = parsed.delta?.text;
            if (text) {
              yield { content: text, done: false };
            }
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    yield { content: '', done: true };
  }

  estimateCost(inputTokens: number, outputTokens: number, modelId: string): number {
    const costs = CLAUDE_COSTS[modelId as keyof typeof CLAUDE_COSTS];
    if (!costs) return 0;
    return (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;
  }

  countTokens(text: string): number {
    // Claude uses tiktoken (cl100k_base), ~4 chars is rough estimate
    return Math.ceil(text.length / 4);
  }
}
