import * as vscode from 'vscode';
import { MiMoProvider } from './provider';
import { MiMoChatParticipant } from './chat';
import { MiMoChatViewProvider } from './webview';

const panels = new Map<number, { panel: vscode.WebviewPanel; provider: MiMoChatViewProvider }>();

export function activate(context: vscode.ExtensionContext) {
  let panelCounter = 0;
  // Register the model provider
  const provider = new MiMoProvider();
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('mimo', provider)
  );

  // Register the VS Code chat participant
  const chat = new MiMoChatParticipant();
  context.subscriptions.push(chat.register(context));

  // Sidebar provider (shared instance)
  const sidebarProvider = new MiMoChatViewProvider(context.extensionUri);
  sidebarProvider.setExtensionContext(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('mimo.chatView', sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  /** Persist the list of open tab IDs so they survive restart */
  function persistOpenTabs() {
    const openIds = [...panels.keys()];
    context.workspaceState.update('mimo.openTabs', openIds);
  }

  /** Wire up a tab panel with its provider */
  function wireTab(id: number, panel: vscode.WebviewPanel, tabProvider: MiMoChatViewProvider) {
    tabProvider.setTabId(id);
    tabProvider.setExtensionContext(context);
    tabProvider.setActiveWebview(panel.webview);

    // Tell the webview its tabId so it can persist it via setState()
    panel.webview.postMessage({ type: 'init', tabId: id });

    // If there's saved history, tell the webview to show a restored indicator
    if (tabProvider.hasHistory()) {
      panel.webview.postMessage({ type: 'restored' });
    }

    panel.webview.onDidReceiveMessage((message) => tabProvider.handleWebviewMessage(message));

    panel.onDidDispose(() => {
      panels.delete(id);
      persistOpenTabs();
      // History is cleaned up only via clearHistory() (user action).
      // On VS Code shutdown, dispose fires but history stays for restore.
    });

    panels.set(id, { panel, provider: tabProvider });
    persistOpenTabs();
  }

  // Open a NEW chat tab (each tab = independent conversation)
  function openNewChatPanel() {
    if (panels.size === 0) {
      panelCounter = 0;
    }
    panelCounter++;
    const id = panelCounter;

    const tabProvider = new MiMoChatViewProvider(context.extensionUri);

    const panel = vscode.window.createWebviewPanel(
      'mimo.chatPanel',
      `MiMo #${id}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri]
      }
    );

    panel.webview.html = tabProvider.getHtml(panel.webview);
    wireTab(id, panel, tabProvider);
  }

  // Restore tab counter from saved tabs
  const savedTabs = context.workspaceState.get<number[]>('mimo.openTabs', []);
  if (savedTabs.length > 0) {
    panelCounter = Math.max(...savedTabs);
  }

  // Serializer: VS Code calls this to restore panels that were open when the window closed
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer('mimo.chatPanel', {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: any) {
        const id = state?.tabId || ++panelCounter;
        const tabProvider = new MiMoChatViewProvider(context.extensionUri);

        panel.webview.options = {
          enableScripts: true,
          localResourceRoots: [context.extensionUri]
        };
        panel.webview.html = tabProvider.getHtml(panel.webview);
        wireTab(id, panel, tabProvider);
      }
    })
  );

  // Open chat = always new tab (multi-agent)
  context.subscriptions.push(
    vscode.commands.registerCommand('mimo.openChat', openNewChatPanel)
  );

  // New chat in sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand('mimo.newChat', () => {
      sidebarProvider.clearHistory();
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
        'Test Connection',
        'New Chat Tab'
      );

      if (action === 'Change Key') {
        const newKey = await vscode.window.showInputBox({
          prompt: 'Enter your MiMo API Key (tp-... for Token Plan, sk-... for API)',
          password: true,
          value: currentKey,
          placeHolder: 'tp-... or sk-...'
        });

        if (newKey !== undefined) {
          await config.update('apiKey', newKey, vscode.ConfigurationTarget.Global);
          await config.update('apiKey', newKey, vscode.ConfigurationTarget.Workspace);
          vscode.window.showInformationMessage('MiMo API Key updated');
        }
      }

      if (action === 'Test Connection') {
        await vscode.commands.executeCommand('mimo.test');
      }

      if (action === 'New Chat Tab') {
        openNewChatPanel();
      }
    })
  );

  // Test connection
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
          { location: vscode.ProgressLocation.Notification, title: 'Testing MiMo...', cancellable: true },
          async () => {
            const response = await fetch(`${baseUrl}/models`, {
              headers: { 'Authorization': `Bearer ${apiKey}` },
              signal: AbortSignal.timeout(10000)
            });

            if (response.ok) {
              const data = await response.json() as any;
              const models = data.data?.map((m: any) => m.id).join(', ') || 'unknown';
              vscode.window.showInformationMessage(`MiMo: Connected — ${models}`);
            } else {
              vscode.window.showErrorMessage(`MiMo: Error ${response.status}`);
            }
          }
        );
      } catch (error: any) {
        vscode.window.showErrorMessage(`MiMo: ${error.message}`);
      }
    })
  );

  console.log('MiMo by Xiaomi extension activated');
}

export function deactivate() {}
