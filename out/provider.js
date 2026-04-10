"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MiMoProvider = void 0;
const vscode = __importStar(require("vscode"));
const MIMO_MODELS = [
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
class MiMoProvider {
    getApiKey() {
        // Read from workspace first, then fall back to user/global settings
        const config = vscode.workspace.getConfiguration('mimo');
        const inspect = config.inspect('apiKey');
        return inspect?.workspaceValue || inspect?.globalValue || '';
    }
    getBaseUrl() {
        const config = vscode.workspace.getConfiguration('mimo');
        const inspect = config.inspect('baseUrl');
        return inspect?.workspaceValue || inspect?.globalValue || 'https://token-plan-ams.xiaomimimo.com/v1';
    }
    async provideLanguageModelChatInformation(options, token) {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            if (!options.silent) {
                const action = await vscode.window.showInformationMessage('MiMo: Configura tu API Key para usar los modelos MiMo.', 'Configurar');
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
    async provideLanguageModelChatResponse(model, messages, options, progress, token) {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            throw new Error('MiMo API Key no configurada. Usa el comando "MiMo: Configure API Key".');
        }
        const baseUrl = this.getBaseUrl();
        const convertedMessages = this.convertMessages(messages);
        const body = {
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
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: '))
                        continue;
                    const data = trimmed.slice(6);
                    if (data === '[DONE]')
                        return;
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content;
                        if (content) {
                            progress.report(new vscode.LanguageModelTextPart(content));
                        }
                    }
                    catch {
                        // Skip malformed JSON chunks
                    }
                }
            }
        }
        catch (error) {
            if (error.name === 'AbortError' || error.name === 'TimeoutError') {
                throw new Error('MiMo: Timeout de conexión (120s). Verifica tu API Key y conexión.');
            }
            throw error;
        }
    }
    async provideTokenCount(model, input, token) {
        // Simple estimation: ~4 chars per token for Chinese/English mixed content
        if (typeof input === 'string') {
            return Math.ceil(input.length / 4);
        }
        let total = 0;
        for (const part of input.content) {
            if (part instanceof vscode.LanguageModelTextPart) {
                total += Math.ceil(part.value.length / 4);
            }
            else {
                // Tool calls/results estimated at ~100 tokens
                total += 100;
            }
        }
        return total;
    }
    convertMessages(messages) {
        const result = [];
        for (const msg of messages) {
            const role = msg.role === vscode.LanguageModelChatMessageRole.User
                ? 'user'
                : 'assistant';
            // Extract text content from parts
            const textParts = [];
            for (const part of msg.content) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    textParts.push(part.value);
                }
                else if (part instanceof vscode.LanguageModelToolCallPart) {
                    // Convert tool calls to text representation
                    textParts.push(`[Tool Call: ${part.name}]`);
                }
                else if (part instanceof vscode.LanguageModelToolResultPart) {
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
exports.MiMoProvider = MiMoProvider;
//# sourceMappingURL=provider.js.map