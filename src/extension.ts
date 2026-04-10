import * as vscode from 'vscode';
import { MiMoProvider } from './provider';
import { MiMoChatParticipant } from './chat';
import { MiMoChatViewProvider } from './webview';

let currentPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Register the model provider
  const provider = new MiMoProvider();
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('mimo', provider)
  );

  // Register the VS Code chat participant
  const chat = new MiMoChatParticipant();
  context.subscriptions.push(chat.register(context));

  // Register the sidebar webview (fallback)
  const chatViewProvider = new MiMoChatViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('mimo.chatView', chatViewProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Open chat as editor tab (like Claude Code)
  function openChatPanel() {
    if (currentPanel) {
      currentPanel.reveal(vscode.ViewColumn.One);
      return;
    }

    currentPanel = vscode.window.createWebviewPanel(
      'mimo.chatPanel',
      'MiMo by Xiaomi',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri]
      }
    );

    currentPanel.webview.html = chatViewProvider.getHtml(currentPanel.webview);

    // Handle messages from the webview
    currentPanel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'sendMessage':
          await handleChatMessage(message.text, currentPanel!.webview);
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
  async function handleChatMessage(text: string, webview: vscode.Webview) {
    // Forward to the chat view provider's handler
    // We need to use the provider's internal state
    (chatViewProvider as any).view = { webview };
    await (chatViewProvider as any).handleUserMessage(text);
  }

  // Status bar button — custom MiMo icon
  const statusBarBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarBtn.text = "$(mimo-logo)";
  statusBarBtn.tooltip = 'Open MiMo Chat';
  statusBarBtn.command = 'mimo.openChat';
  statusBarBtn.show();
  context.subscriptions.push(statusBarBtn);

  // Open chat command — opens in editor tab
  context.subscriptions.push(
    vscode.commands.registerCommand('mimo.openChat', openChatPanel)
  );

  // New chat command
  context.subscriptions.push(
    vscode.commands.registerCommand('mimo.newChat', () => {
      chatViewProvider.clearHistory();
    })
  );

  // Management command
  context.subscriptions.push(
    vscode.commands.registerCommand('mimo.manage', async () => {
      const config = vscode.workspace.getConfiguration('mimo');
      const currentKey = config.get<string>('apiKey', '');

      const maskedKey = currentKey
        ? `${currentKey.substring(0, 8)}...${currentKey.substring(currentKey.length - 4)}`
        : '(not configured)';

      const action = await vscode.window.showInformationMessage(
        `MiMo API Key: ${maskedKey}`,
        'Change Key',
        'Change Base URL',
        'Test Connection',
        'Open Chat'
      );

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
        const currentUrl = config.get<string>('baseUrl', 'https://token-plan-ams.xiaomimimo.com/v1');
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
    })
  );

  // Test connection command
  context.subscriptions.push(
    vscode.commands.registerCommand('mimo.test', async () => {
      const config = vscode.workspace.getConfiguration('mimo');
      const apiKey = config.get<string>('apiKey', '');
      const baseUrl = config.get<string>('baseUrl', 'https://token-plan-ams.xiaomimimo.com/v1');

      if (!apiKey) {
        vscode.window.showErrorMessage('MiMo: API Key not configured');
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Testing MiMo connection...',
            cancellable: true
          },
          async (progress, token) => {
            const response = await fetch(`${baseUrl}/models`, {
              headers: { 'Authorization': `Bearer ${apiKey}` },
              signal: AbortSignal.timeout(10000)
            });

            if (response.ok) {
              const data = await response.json() as any;
              const models = data.data?.map((m: any) => m.id).join(', ') || 'unknown';
              vscode.window.showInformationMessage(`MiMo: Connected ✅ — ${models}`);
            } else {
              vscode.window.showErrorMessage(`MiMo: Error ${response.status} — ${await response.text()}`);
            }
          }
        );
      } catch (error: any) {
        vscode.window.showErrorMessage(`MiMo: Connection error — ${error.message}`);
      }
    })
  );

  console.log('MiMo by Xiaomi extension activated');
}

async function insertCodeToEditor(code: string) {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    await editor.edit((editBuilder) => {
      const selection = editor.selection;
      if (!selection.isEmpty) {
        editBuilder.replace(selection, code);
      } else {
        editBuilder.insert(selection.active, code);
      }
    });
  }
}

export function deactivate() {}
