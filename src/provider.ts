import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MiMoModel {
  id: string;
  name: string;
  family: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  description: string;
  supportsVision: boolean;
  supportsThinking: boolean;
}

export interface ProviderDef {
  id: string;
  name: string;
  family: string;
  configKey: string;
  urlKey: string;
  defaultBaseUrl: string;
}

export interface ApiConfig {
  apiKey: string;
  baseUrl: string;
  provider: ProviderDef;
}

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'mimo',
    name: 'Xiaomi MiMo',
    family: 'mimo',
    configKey: 'apiKey',
    urlKey: 'baseUrl',
    defaultBaseUrl: 'https://token-plan-ams.xiaomimimo.com/v1'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    family: 'deepseek',
    configKey: 'deepseekApiKey',
    urlKey: 'deepseekBaseUrl',
    defaultBaseUrl: 'https://api.deepseek.com/v1'
  },
  {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    family: 'kimi',
    configKey: 'kimiApiKey',
    urlKey: 'kimiBaseUrl',
    defaultBaseUrl: 'https://api.moonshot.cn/v1'
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    family: 'minimax',
    configKey: 'minimaxApiKey',
    urlKey: 'minimaxBaseUrl',
    defaultBaseUrl: 'https://api.minimax.io/v1'
  }
];

// ---------------------------------------------------------------------------
// Fallback Models (only used when API is unreachable)
// ---------------------------------------------------------------------------

export const FALLBACK_MODELS: MiMoModel[] = [
  {
    id: 'mimo-v2-pro',
    name: 'MiMo V2 Pro',
    family: 'mimo',
    maxInputTokens: 1_048_576,
    maxOutputTokens: 131_072,
    description: 'Advanced reasoning, complex tasks, 1M context',
    supportsVision: false,
    supportsThinking: true
  },
  {
    id: 'mimo-v2-omni',
    name: 'MiMo V2 Omni',
    family: 'mimo',
    maxInputTokens: 262_144,
    maxOutputTokens: 131_072,
    description: 'Multimodal — images, audio, video + reasoning',
    supportsVision: true,
    supportsThinking: true
  },
  {
    id: 'mimo-v2-flash',
    name: 'MiMo V2 Flash',
    family: 'mimo',
    maxInputTokens: 262_144,
    maxOutputTokens: 65_536,
    description: 'Fast and efficient, 150+ tokens/sec',
    supportsVision: false,
    supportsThinking: false
  },
  {
    id: 'MiniMax-M2.7',
    name: 'MiniMax M2.7',
    family: 'minimax',
    maxInputTokens: 204_800,
    maxOutputTokens: 65_536,
    description: 'Recursive self-improvement, 60 tps',
    supportsVision: false,
    supportsThinking: true
  },
  {
    id: 'MiniMax-M2.5',
    name: 'MiniMax M2.5',
    family: 'minimax',
    maxInputTokens: 204_800,
    maxOutputTokens: 65_536,
    description: 'Peak performance, tool calling & search',
    supportsVision: false,
    supportsThinking: true
  },
  {
    id: 'MiniMax-M2.1',
    name: 'MiniMax M2.1',
    family: 'minimax',
    maxInputTokens: 204_800,
    maxOutputTokens: 65_536,
    description: 'Multi-language programming, code refactoring',
    supportsVision: false,
    supportsThinking: true
  }
];

// ---------------------------------------------------------------------------
// Dynamic Model Store
// ---------------------------------------------------------------------------

let _dynamicModels: MiMoModel[] | null = null;

export function getModels(): MiMoModel[] {
  return _dynamicModels || FALLBACK_MODELS;
}

export function getModel(id: string): MiMoModel {
  return getModels().find(m => m.id === id) || getModels()[0];
}

// ---------------------------------------------------------------------------
// Provider Config Resolution
// ---------------------------------------------------------------------------

/**
 * Get API config for a specific provider.
 * Reads apiKey and baseUrl from VS Code settings.
 */
export function getProviderConfig(providerId: string): ApiConfig {
  const provider = PROVIDERS.find(p => p.id === providerId);
  if (!provider) {
    return { apiKey: '', baseUrl: '', provider: PROVIDERS[0] };
  }

  const config = vscode.workspace.getConfiguration('mimo');
  const inspectKey = config.inspect<string>(provider.configKey);
  const apiKey = inspectKey?.workspaceValue || inspectKey?.globalValue || '';

  const inspectUrl = config.inspect<string>(provider.urlKey);
  const customUrl = inspectUrl?.workspaceValue || inspectUrl?.globalValue;

  // MiMo special: resolve baseUrl from key prefix if no custom URL
  let baseUrl = customUrl || provider.defaultBaseUrl;
  if (providerId === 'mimo' && !customUrl && apiKey.startsWith('sk-')) {
    baseUrl = 'https://api.xiaomimimo.com/v1';
  }

  return { apiKey, baseUrl, provider };
}

/**
 * Get the API config for a given model ID.
 * Detects the provider from the model ID prefix.
 */
export function getApiConfigForModel(modelId: string): ApiConfig {
  if (modelId.startsWith('deepseek')) {
    return getProviderConfig('deepseek');
  }
  if (modelId.startsWith('MiniMax') || modelId.startsWith('minimax')) {
    return getProviderConfig('minimax');
  }
  if (modelId.startsWith('moonshot') || modelId.startsWith('kimi')) {
    return getProviderConfig('kimi');
  }
  return getProviderConfig('mimo');
}

/**
 * Legacy: get MiMo API config (for backward compatibility).
 */
export function getApiConfig(): ApiConfig & { keyType: string; flashAvailable: boolean } {
  const cfg = getProviderConfig('mimo');
  const config = vscode.workspace.getConfiguration('mimo');
  const useFlash = config.get<boolean>('useFlashForSimpleTasks', false);

  let keyType = 'unknown';
  let flashAvailable = useFlash;
  if (cfg.apiKey.startsWith('tp-')) {
    keyType = 'token-plan';
  } else if (cfg.apiKey.startsWith('sk-')) {
    keyType = 'api';
    flashAvailable = true;
  }

  return { ...cfg, keyType, flashAvailable };
}

// ---------------------------------------------------------------------------
// Dynamic Model Fetching
// ---------------------------------------------------------------------------

/**
 * Fetch models from a single provider's /models endpoint.
 * Returns empty array on failure (caller handles fallback).
 */
async function fetchProviderModels(provider: ProviderDef): Promise<MiMoModel[]> {
  const config = getProviderConfig(provider.id);
  if (!config.apiKey) return [];

  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      console.warn(`MiMo: ${provider.name} /models returned ${response.status}`);
      return [];
    }

    const data = await response.json() as { data?: any[] };
    if (!data.data || !Array.isArray(data.data)) return [];

    const models: MiMoModel[] = data.data.map((m: any) => {
      const id = m.id || '';
      const lowerId = id.toLowerCase();
      const lowerName = (m.name || m.id || '').toLowerCase();

      // Infer capabilities from model ID/name patterns
      const supportsVision = lowerId.includes('omni') || lowerId.includes('vision')
        || lowerName.includes('omni') || lowerName.includes('vision')
        || lowerName.includes('multimodal');
      const supportsThinking = lowerId.includes('pro') || lowerId.includes('omni')
        || lowerId.includes('reasoner') || lowerName.includes('thinking')
        || (!lowerId.includes('flash') && !lowerId.includes('chat'));

      return {
        id,
        name: m.name || m.id || id,
        family: provider.family,
        maxInputTokens: m.max_input_tokens || m.context_length || 262_144,
        maxOutputTokens: m.max_output_tokens || m.max_tokens || 65_536,
        description: m.description || `${provider.name} · ${m.name || id}`,
        supportsVision,
        supportsThinking
      };
    });

    console.log(`MiMo: Loaded ${models.length} models from ${provider.name}:`, models.map(m => m.id).join(', '));
    return models;
  } catch (err: any) {
    console.warn(`MiMo: Failed to fetch models from ${provider.name}:`, err.message);
    return [];
  }
}

/**
 * Fetch available models from ALL configured providers.
 * Merges results into a single dynamic model list.
 * Falls back to hardcoded models only if ALL providers fail.
 */
export async function fetchModelsFromApi(): Promise<MiMoModel[]> {
  const results = await Promise.all(
    PROVIDERS.map(p => fetchProviderModels(p))
  );

  const allModels = results.flat();

  if (allModels.length > 0) {
    _dynamicModels = allModels;
    return allModels;
  }

  // All providers failed — use hardcoded fallback
  console.warn('MiMo: All providers failed, using fallback models');
  return FALLBACK_MODELS;
}

// ---------------------------------------------------------------------------
// Model Selection
// ---------------------------------------------------------------------------

/**
 * Get model list for UI selectors, grouped by provider.
 */
export function getModelOptions(): { value: string; label: string; providerName: string }[] {
  return getModels().map(m => {
    const provider = PROVIDERS.find(p => p.family === m.family);
    return {
      value: m.id,
      label: m.name,
      providerName: provider?.name || m.family
    };
  });
}

/**
 * Pick the best model for a given task.
 * - Respects user manual selection
 * - Images → vision-capable model
 * - Simple tool calls → fastest model (flash-like)
 * - Complex tasks → best reasoning model
 */
export function pickModel(hasImages: boolean, lastToolName?: string, _iteration?: number): string {
  const models = getModels();

  // User-selected model override
  const preferred = vscode.workspace.getConfiguration('mimo').get<string>('preferredModel');
  if (preferred && preferred !== 'auto') return preferred;

  // Images → use a vision-capable model
  if (hasImages) {
    const visionModel = models.find(m => m.supportsVision);
    if (visionModel) return visionModel.id;
  }

  // Simple tool calls → use the fastest model available
  if (lastToolName) {
    const simpleTasks = new Set([
      'read_file', 'list_files', 'find_files', 'search_files', 'get_diagnostics'
    ]);
    if (simpleTasks.has(lastToolName)) {
      const flashModel = models.find(m =>
        m.id.includes('flash') || (!m.supportsThinking && !m.supportsVision)
      );
      if (flashModel) return flashModel.id;
    }
  }

  // Complex tasks → prefer the most capable reasoning model
  const proModel = models.find(m => m.id.includes('pro') && m.supportsThinking);
  if (proModel) return proModel.id;

  const omniModel = models.find(m => m.id.includes('omni') && m.supportsThinking);
  if (omniModel) return omniModel.id;

  const thinkingModel = models.find(m => m.supportsThinking);
  if (thinkingModel) return thinkingModel.id;

  return models[0].id;
}

// ---------------------------------------------------------------------------
// Cross-Provider Fallback System
// ---------------------------------------------------------------------------

// Track failed models to avoid retrying them immediately
const _failedModels = new Map<string, number>(); // modelId → timestamp of failure
const FAILURE_COOLDOWN_MS = 60_000; // 1 minute cooldown after failure

/**
 * Mark a model as failed (called by chat/webview on API error).
 */
export function markModelFailed(modelId: string): void {
  _failedModels.set(modelId, Date.now());
  console.warn(`MiMo: Model ${modelId} marked as failed`);
}

/**
 * Clear failure mark for a model (e.g., on successful response).
 */
export function markModelSuccess(modelId: string): void {
  _failedModels.delete(modelId);
}

/**
 * Check if a model is in cooldown (recently failed).
 */
function isModelInCooldown(modelId: string): boolean {
  const failedAt = _failedModels.get(modelId);
  if (!failedAt) return false;
  if (Date.now() - failedAt > FAILURE_COOLDOWN_MS) {
    _failedModels.delete(modelId); // Cooldown expired
    return false;
  }
  return true;
}

/**
 * Get the next fallback model when the current one fails.
 * Tries: same provider → other providers → hardcoded fallbacks.
 * Returns null if no fallback is available.
 */
export function getNextFallbackModel(failedModelId: string, hasImages: boolean): string | null {
  const models = getModels();
  const failedModel = models.find(m => m.id === failedModelId);
  
  // Mark the failed model
  markModelFailed(failedModelId);
  
  // Filter out failed models and models in cooldown
  const availableModels = models.filter(m => 
    m.id !== failedModelId && !isModelInCooldown(m.id)
  );
  
  if (availableModels.length === 0) {
    console.warn('MiMo: No available fallback models');
    return null;
  }
  
  // Strategy 1: Try another model from the same provider
  if (failedModel) {
    const sameProvider = availableModels.filter(m => m.family === failedModel.family);
    if (sameProvider.length > 0) {
      // Prefer models with similar capabilities
      const similar = sameProvider.find(m => 
        m.supportsVision === failedModel.supportsVision &&
        m.supportsThinking === failedModel.supportsThinking
      );
      if (similar) {
        console.log(`MiMo: Fallback to same provider: ${similar.id}`);
        return similar.id;
      }
      // Otherwise, pick the first available from same provider
      console.log(`MiMo: Fallback to same provider (different capabilities): ${sameProvider[0].id}`);
      return sameProvider[0].id;
    }
  }
  
  // Strategy 2: Try another provider
  const otherProviders = availableModels.filter(m => 
    !failedModel || m.family !== failedModel.family
  );
  
  if (otherProviders.length > 0) {
    // If we need vision, prefer vision-capable models
    if (hasImages) {
      const visionModel = otherProviders.find(m => m.supportsVision);
      if (visionModel) {
        console.log(`MiMo: Fallback to other provider (vision): ${visionModel.id}`);
        return visionModel.id;
      }
    }
    
    // Otherwise, prefer reasoning models
    const reasoningModel = otherProviders.find(m => m.supportsThinking);
    if (reasoningModel) {
      console.log(`MiMo: Fallback to other provider (reasoning): ${reasoningModel.id}`);
      return reasoningModel.id;
    }
    
    // Last resort: any available model
    console.log(`MiMo: Fallback to other provider (any): ${otherProviders[0].id}`);
    return otherProviders[0].id;
  }
  
  // Strategy 3: Use hardcoded fallbacks (ignore cooldown for these)
  const hardcodedFallbacks = FALLBACK_MODELS.filter(m => m.id !== failedModelId);
  if (hardcodedFallbacks.length > 0) {
    console.log(`MiMo: Fallback to hardcoded: ${hardcodedFallbacks[0].id}`);
    return hardcodedFallbacks[0].id;
  }
  
  return null;
}

/**
 * Get a ranked list of fallback models for a given model.
 * Used by chat/webview to try multiple fallbacks in sequence.
 */
export function getFallbackChain(modelId: string, hasImages: boolean): string[] {
  const chain: string[] = [];
  let current = modelId;
  const seen = new Set<string>([modelId]);
  
  // Build chain of up to 5 fallbacks
  for (let i = 0; i < 5; i++) {
    const next = getNextFallbackModel(current, hasImages);
    if (!next || seen.has(next)) break;
    chain.push(next);
    seen.add(next);
    current = next;
  }
  
  return chain;
}

// ---------------------------------------------------------------------------
// VS Code Language Model Chat Provider
// ---------------------------------------------------------------------------

export class MiMoProvider implements vscode.LanguageModelChatProvider {

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    // Check if at least one provider has an API key configured
    const hasAnyKey = PROVIDERS.some(p => getProviderConfig(p.id).apiKey);

    if (!hasAnyKey) {
      if (!options.silent) {
        const action = await vscode.window.showInformationMessage(
          'MiMo: Configure at least one API Key (MiMo or DeepSeek).',
          'Configure'
        );
        if (action === 'Configure') {
          await vscode.commands.executeCommand('mimo.manage');
        }
      }
      return [];
    }

    return getModels().map(model => {
      const provider = PROVIDERS.find(p => p.family === model.family);
      return {
        id: model.id,
        name: model.name,
        family: model.family,
        version: '2.0.0',
        maxInputTokens: model.maxInputTokens,
        maxOutputTokens: model.maxOutputTokens,
        tooltip: model.description,
        detail: `${provider?.name || model.family} · ${(model.maxInputTokens / 1024).toFixed(0)}K context`,
        capabilities: {
          imageInput: model.supportsVision,
          toolCalling: true
        }
      };
    });
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const { apiKey, baseUrl } = getApiConfigForModel(model.id);
    if (!apiKey) {
      const provider = PROVIDERS.find(p => p.family === model.family);
      throw new Error(`${provider?.name || 'Provider'} API Key not configured. Use "MiMo: Configure API Key".`);
    }

    const spec = getModel(model.id);
    const convertedMessages = this.convertMessages(messages);

    const body: Record<string, any> = {
      model: model.id,
      messages: convertedMessages,
      stream: true,
      max_completion_tokens: Math.min(spec.maxOutputTokens, 32768),
      temperature: model.id.includes('flash') ? 0.3 : 0.7
    };

    // Enable thinking for models that support it
    if (spec.supportsThinking) {
      body.thinking = { type: 'enabled' };
    }

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
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        if (token.isCancellationRequested) break;

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
            const delta = parsed.choices?.[0]?.delta;
            // MiMo uses "thinking" field, DeepSeek uses "reasoning_content"
            const reasoning = delta?.reasoning_content || delta?.thinking?.content;
            if (reasoning) {
              progress.report(new vscode.LanguageModelTextPart(`[Thinking] ${reasoning}\n`));
            }
            const content = delta?.content;
            if (content) {
              progress.report(new vscode.LanguageModelTextPart(content));
            }
          } catch { /* skip malformed chunks */ }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        throw new Error('Connection timeout (120s).');
      }
      throw error;
    }
  }

  async provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    input: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken
  ): Promise<number> {
    if (typeof input === 'string') {
      return Math.ceil(input.length / 4);
    }
    let total = 0;
    for (const part of input.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        total += Math.ceil(part.value.length / 4);
      } else {
        total += 100;
      }
    }
    return total;
  }

  private convertMessages(
    messages: readonly vscode.LanguageModelChatRequestMessage[]
  ): any[] {
    const result: any[] = [];

    for (const msg of messages) {
      const role = msg.role === vscode.LanguageModelChatMessageRole.User
        ? 'user' : 'assistant';

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

      const content = textParts.join('\n');
      if (content) {
        result.push({ role, content });
      }
    }

    return result;
  }
}
