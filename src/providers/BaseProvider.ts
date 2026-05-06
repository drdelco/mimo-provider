/**
 * Base interface for all AI coding providers.
 * Defines the contract that every provider must implement.
 */

export interface AIModel {
  id: string;
  name: string;
  family: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  description: string;
  capabilities: {
    imageInput: boolean;
    toolCalling: boolean;
    streaming: boolean;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
}

export interface ChatChunk {
  content: string;
  done: boolean;
  toolCalls?: ToolCall[];
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  timeout?: number;
}

export interface AICodingProvider {
  readonly name: string;
  readonly displayName: string;
  readonly models: AIModel[];
  
  /** Check if the provider is available (has valid API key and connectivity) */
  isAvailable(): Promise<boolean>;
  
  /** Send a chat request and receive streaming response */
  chat(options: ChatOptions): AsyncGenerator<ChatChunk, void, unknown>;
  
  /** Estimate cost for given input (in USD) */
  estimateCost(inputTokens: number, outputTokens: number, modelId: string): number;
  
  /** Count tokens for a given text */
  countTokens(text: string): number;
}

/**
 * Factory to create and manage all providers
 */
export class ProviderFactory {
  private providers: Map<string, AICodingProvider> = new Map();
  
  register(provider: AICodingProvider): void {
    this.providers.set(provider.name, provider);
  }
  
  get(name: string): AICodingProvider | undefined {
    return this.providers.get(name);
  }
  
  getAll(): AICodingProvider[] {
    return Array.from(this.providers.values());
  }
  
  getAllModels(): AIModel[] {
    return this.getAll().flatMap(p => p.models);
  }
  
  async getAvailable(): Promise<AICodingProvider[]> {
    const checks = await Promise.all(
      this.getAll().map(async p => ({ provider: p, available: await p.isAvailable() }))
    );
    return checks.filter(c => c.available).map(c => c.provider);
  }
}
