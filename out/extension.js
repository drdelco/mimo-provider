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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const provider_1 = require("./provider");
const chat_1 = require("./chat");
const webview_1 = require("./webview");
let currentPanel;
function activate(context) {
    // Register the model provider
    const provider = new provider_1.MiMoProvider();
    context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider('mimo', provider));
    // Register the VS Code chat participant
    const chat = new chat_1.MiMoChatParticipant();
    context.subscriptions.push(chat.register(context));
    // Register the sidebar webview (fallback)
    const chatViewProvider = new webview_1.MiMoChatViewProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('mimo.chatView', chatViewProvider, {
        webviewOptions: { retainContextWhenHidden: true }
    }));
    // Open chat as editor tab (like Claude Code)
    function openChatPanel() {
        if (currentPanel) {
            currentPanel.reveal(vscode.ViewColumn.One);
            return;
        }
        currentPanel = vscode.window.createWebviewPanel('mimo.chatPanel', 'MiMo by Xiaomi', vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [context.extensionUri]
        });
        currentPanel.webview.html = chatViewProvider.getHtml(currentPanel.webview);
        // Handle messages from the webview
        currentPanel.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'sendMessage':
                    await handleChatMessage(message.text, currentPanel.webview);
                    break;
                case 'clearHistory':
                    chatViewProvider.clearHistory();
                    currentPanel?.webview.postMessage({ type: 'historyCleared' });
                    break;
                case 'insertCode':
                    await insertCodeToEditor(message.code);
                    break;
            }
        });
        currentPanel.onDidDispose(() => {
            currentPanel = undefined;
        });
    }
    // Delegate chat handling to the webview provider
    async function handleChatMessage(text, webview) {
        // Forward to the chat view provider's handler
        // We need to use the provider's internal state
        chatViewProvider.view = { webview };
        await chatViewProvider.handleUserMessage(text);
    }
    // Status bar button — custom MiMo icon
    const statusBarBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarBtn.text = "$(mimo-logo)";
    statusBarBtn.tooltip = 'Open MiMo Chat';
    statusBarBtn.command = 'mimo.openChat';
    statusBarBtn.show();
    context.subscriptions.push(statusBarBtn);
    // Open chat command — opens in editor tab
    context.subscriptions.push(vscode.commands.registerCommand('mimo.openChat', openChatPanel));
    // New chat command
    context.subscriptions.push(vscode.commands.registerCommand('mimo.newChat', () => {
        chatViewProvider.clearHistory();
    }));
    // Management command
    context.subscriptions.push(vscode.commands.registerCommand('mimo.manage', async () => {
        const config = vscode.workspace.getConfiguration('mimo');
        const currentKey = config.get('apiKey', '');
        const maskedKey = currentKey
            ? `${currentKey.substring(0, 8)}...${currentKey.substring(currentKey.length - 4)}`
            : '(not configured)';
        const action = await vscode.window.showInformationMessage(`MiMo API Key: ${maskedKey}`, 'Change Key', 'Change Base URL', 'Test Connection', 'Open Chat');
        if (action === 'Change Key') {
            const newKey = await vscode.window.showInputBox({
                prompt: 'Enter your MiMo API Key',
                password: true,
                value: currentKey,
                placeHolder: 'tp-...'
            });
            if (newKey !== undefined) {
                await config.update('apiKey', newKey, vscode.ConfigurationTarget.Global);
                await config.update('apiKey', newKey, vscode.ConfigurationTarget.Workspace);
                vscode.window.showInformationMessage('MiMo API Key updated ✅');
            }
        }
        if (action === 'Change Base URL') {
            const currentUrl = config.get('baseUrl', 'https://token-plan-ams.xiaomimimo.com/v1');
            const newUrl = await vscode.window.showInputBox({
                prompt: 'MiMo API Base URL',
                value: currentUrl,
                placeHolder: 'https://token-plan-ams.xiaomimimo.com/v1'
            });
            if (newUrl !== undefined) {
                await config.update('baseUrl', newUrl, vscode.ConfigurationTarget.Global);
                await config.update('baseUrl', newUrl, vscode.ConfigurationTarget.Workspace);
                vscode.window.showInformationMessage('MiMo Base URL updated ✅');
            }
        }
        if (action === 'Test Connection') {
            await vscode.commands.executeCommand('mimo.test');
        }
        if (action === 'Open Chat') {
            openChatPanel();
        }
    }));
    // Test connection command
    context.subscriptions.push(vscode.commands.registerCommand('mimo.test', async () => {
        const config = vscode.workspace.getConfiguration('mimo');
        const apiKey = config.get('apiKey', '');
        const baseUrl = config.get('baseUrl', 'https://token-plan-ams.xiaomimimo.com/v1');
        if (!apiKey) {
            vscode.window.showErrorMessage('MiMo: API Key not configured');
            return;
        }
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Testing MiMo connection...',
                cancellable: true
            }, async (progress, token) => {
                const response = await fetch(`${baseUrl}/models`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` },
                    signal: AbortSignal.timeout(10000)
                });
                if (response.ok) {
                    const data = await response.json();
                    const models = data.data?.map((m) => m.id).join(', ') || 'unknown';
                    vscode.window.showInformationMessage(`MiMo: Connected ✅ — ${models}`);
                }
                else {
                    vscode.window.showErrorMessage(`MiMo: Error ${response.status} — ${await response.text()}`);
                }
            });
        }
        catch (error) {
            vscode.window.showErrorMessage(`MiMo: Connection error — ${error.message}`);
        }
    }));
    console.log('MiMo by Xiaomi extension activated');
}
async function insertCodeToEditor(code) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        await editor.edit((editBuilder) => {
            const selection = editor.selection;
            if (!selection.isEmpty) {
                editBuilder.replace(selection, code);
            }
            else {
                editBuilder.insert(selection.active, code);
            }
        });
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map