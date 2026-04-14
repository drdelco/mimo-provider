import * as vscode from 'vscode';

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

export const MIMO_MODELS: MiMoModel[] = [
  {
    id: 'mimo-v2-pro',
    name: 'MiMo V2 Pro',
    family: 'mimo',
    maxInputTokens: 1_048_576,   // 1M
    maxOutputTokens: 131_072,    // 128K
    description: 'Advanced reasoning, complex tasks, 1M context',
    supportsVision: false,
    supportsThinking: true
  },
  {
    id: 'mimo-v2-omni',
    name: 'MiMo V2 Omni',
    family: 'mimo',
    maxInputTokens: 262_144,     // 256K
    maxOutputTokens: 131_072,    // 128K
    description: 'Multimodal — images, audio, video + reasoning',
    supportsVision: true,
    supportsThinking: true
  },
  {
    id: 'mimo-v2-flash',
    name: 'MiMo V2 Flash',
    family: 'mimo',
    maxInputTokens: 262_144,     // 256K
    maxOutputTokens: 65_536,     // 64K
    description: 'Fast and efficient, 150+ tokens/sec',
    supportsVision: false,
    supportsThinking: false
  }
];

/** Get a model spec by ID */
export function getModel(id: string): MiMoModel {
  return MIMO_MODELS.find(m => m.id === id) || MIMO_MODELS[0];
}

export interface ApiConfig {
  apiKey: string;
  baseUrl: string;
  /** 'token-plan' = tp-* key, 'api' = sk-* key */
  keyType: 'token-plan' | 'api' | 'unknown';
  /** Flash is available on api plans (sk-*) or when explicitly enabled */
  flashAvailable: boolean;
}

/**
 * Resolve API configuration from the key prefix.
 * - tp-* keys → token-plan-ams endpoint (Flash usually not included)
 * - sk-* keys → api endpoint (all models available)
 * Respects user-configured baseUrl if set.
 */
export function getApiConfig(): ApiConfig {
  const config = vscode.workspace.getConfiguration('mimo');
  const inspectKey = config.inspect<string>('apiKey');
  const apiKey = inspectKey?.workspaceValue || inspectKey?.globalValue || '';

  const inspectUrl = config.inspect<string>('baseUrl');
  const customUrl = inspectUrl?.workspaceValue || inspectUrl?.globalValue;
  const useFlash = config.get<boolean>('useFlashForSimpleTasks', false);

  if (apiKey.startsWith('tp-')) {
    return {
      apiKey,
      baseUrl: customUrl || 'https://token-plan-ams.xiaomimimo.com/v1',
      keyType: 'token-plan',
      flashAvailable: useFlash // only if user explicitly enables it
    };
  }

  if (apiKey.startsWith('sk-')) {
    return {
      apiKey,
      baseUrl: customUrl || 'https://api.xiaomimimo.com/v1',
      keyType: 'api',
      flashAvailable: true // api plans include all models
    };
  }

  return {
    apiKey,
    baseUrl: customUrl || 'https://token-plan-ams.xiaomimimo.com/v1',
    keyType: 'unknown',
    flashAvailable: useFlash
  };
}

/**
 * Pick the best model for a given task.
 * - omni: when there are images in the conversation
 * - flash: for simple tool calls, only if available in the plan
 * - pro: default for everything else
 */
export function pickModel(hasImages: boolean, lastToolName?: string): string {
  if (hasImages) return 'mimo-v2-omni';

  // User-selected model override (from UI selector)
  const preferred = vscode.workspace.getConfiguration('mimo').get<string>('preferredModel');
  if (preferred && preferred !== 'auto') return preferred;

  const { flashAvailable } = getApiConfig();

  if (flashAvailable && lastToolName) {
    const simpleTasks = new Set([
      'read_file', 'list_files', 'find_files', 'search_files', 'get_diagnostics'
    ]);
    if (simpleTasks.has(lastToolName)) {
      return 'mimo-v2-flash';
    }
  }

  return 'mimo-v2-pro';
}

// ---------------------------------------------------------------------------
// VS Code Language Model Chat Provider
// ---------------------------------------------------------------------------

export class MiMoProvider implements vscode.LanguageModelChatProvider {

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const { apiKey } = getApiConfig();

    if (!apiKey) {
      if (!options.silent) {
        const action = await vscode.window.showInformationMessage(
          'MiMo: Configure your API Key to use MiMo models.',
          'Configure'
        );
        if (action === 'Configure') {
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
      detail: `Xiaomi · ${(model.maxInputTokens / 1024).toFixed(0)}K context`,
      capabilities: {
        imageInput: model.supportsVision,
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
    const { apiKey, baseUrl } = getApiConfig();
    if (!apiKey) {
      throw new Error('MiMo API Key not configured. Use "MiMo: Configure API Key".');
    }
    const spec = getModel(model.id);
    const convertedMessages = this.convertMessages(messages);

    const body: Record<string, any> = {
      model: model.id,
      messages: convertedMessages,
      stream: true,
      max_completion_tokens: Math.min(spec.maxOutputTokens, 32768),
      temperature: spec.id === 'mimo-v2-flash' ? 0.3 : 0.7
    };

    // Enable thinking for Pro and Omni
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
        throw new Error(`MiMo API error ${response.status}: ${errorText}`);
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
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              progress.report(new vscode.LanguageModelTextPart(content));
            }
          } catch { /* skip malformed chunks */ }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        throw new Error('MiMo: Connection timeout (120s).');
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
