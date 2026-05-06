/**
 * AI Orchestra - Multi-Provider Extension
 * Entry point that registers all providers and orchestration
 */

import * as vscode from 'vscode';
import { MiMoProvider } from './providers/MiMoProvider';
import { KimiProvider } from './providers/KimiProvider';
import { DeepSeekProvider } from './providers/DeepSeekProvider';
import { ClaudeProvider } from './providers/ClaudeProvider';
import { ProviderFactory } from './providers/BaseProvider';
import { CodingDirector } from './orchestra/Director';
import { AgentPool, DEFAULT_LIMITS } from './orchestra/AgentPool';
import { MiMoChatParticipant } from './chat';
import { MiMoChatViewProvider } from './webview';

let currentPanel: vscode.WebviewPanel | undefined;
let orchestraPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Initialize provider factory
  const factory = new ProviderFactory();
  factory.register(new MiMoProvider());
  factory.register(new KimiProvider());
  factory.register(new DeepSeekProvider());
  factory.register(new ClaudeProvider());

  // Register all model providers with VS Code
  const mimoProvider = new MiMoProvider();
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('mimo', mimoProvider)
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

  // Open chat as editor tab
  function openChatPanel() {
    if (currentPanel) {
      currentPanel.reveal(vscode.ViewColumn.One);
      return;
    }

    currentPanel = vscode.window.createWebviewPanel(
      'mimo.chatPanel',
      'AI Orchestra Chat',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri]
      }
    );

    currentPanel.webview.html = chatViewProvider.getHtml(currentPanel.webview);

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

  async function handleChatMessage(text: string, webview: vscode.Webview) {
    (chatViewProvider as any).view = { webview };
    await (chatViewProvider as any).handleUserMessage(text);
  }

  // ========== ORCHESTRA COMMANDS ==========

  // Execute complex task with orchestration
  context.subscriptions.push(
    vscode.commands.registerCommand('orchestra.execute', async () => {
      const request = await vscode.window.showInputBox({
        prompt: '🎼 Describe the complex coding task',
        placeHolder: 'e.g., "Create a JWT authentication system with refresh tokens, role-based access, and rate limiting"',
        validateInput: (value) => value ? null : 'Please enter a task description'
      });

      if (!request) return;

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
      const orchestraConfig = vscode.workspace.getConfiguration('orchestra');
      const poolLimits = orchestraConfig.get<Record<string, number>>('poolLimits') ?? DEFAULT_LIMITS;
      const budget = orchestraConfig.get<number>('budgetLimit') ?? 5.0;
      const pool = new AgentPool(poolLimits);
      const director = new CodingDirector(workspaceRoot, budget, pool);

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '🎼 AI Orchestra',
        cancellable: true
      }, async (progress, token) => {
        try {
          const result = await director.execute(request, progress);
          
          // Show results in new panel
          showOrchestraResult(result);
          
          vscode.window.showInformationMessage(
            `✅ Orchestra complete! Cost: $${result.totalCost.toFixed(2)}, Duration: ${(result.totalDuration / 1000).toFixed(1)}s`,
            'View Details'
          );
        } catch (error: any) {
          vscode.window.showErrorMessage(`❌ Orchestra failed: ${error.message}`);
        }
      });
    })
  );

  // Show orchestra status
  context.subscriptions.push(
    vscode.commands.registerCommand('orchestra.status', async () => {
      const available = await factory.getAvailable();
      const all = factory.getAll();
      
      const status = all.map(p => {
        const isAvail = available.find(a => a.name === p.name);
        const icon = isAvail ? '✅' : '❌';
        const models = p.models.map(m => m.name).join(', ');
        return `${icon} ${p.displayName} — ${models}`;
      }).join('\n');

      vscode.window.showInformationMessage(
        `AI Orchestra Status:\n${status}`,
        { modal: true }
      );
    })
  );

  // ========== PROVIDER CONFIG COMMANDS ==========

  // MiMo config
  context.subscriptions.push(
    vscode.commands.registerCommand('mimo.manage', () => configureProvider('mimo'))
  );

  // Kimi config
  context.subscriptions.push(
    vscode.commands.registerCommand('kimi.manage', () => configureProvider('kimi'))
  );

  // DeepSeek config
  context.subscriptions.push(
    vscode.commands.registerCommand('deepseek.manage', () => configureProvider('deepseek'))
  );

  // Claude config
  context.subscriptions.push(
    vscode.commands.registerCommand('claude.manage', () => configureProvider('claude'))
  );

  // Generic provider config helper
  async function configureProvider(providerName: string) {
    const config = vscode.workspace.getConfiguration(providerName);
    const currentKey = config.get<string>('apiKey', '');
    const displayNames: Record<string, string> = {
      mimo: 'MiMo',
      kimi: 'Kimi',
      deepseek: 'DeepSeek',
      claude: 'Claude'
    };
    const displayName = displayNames[providerName] || providerName;

    const maskedKey = currentKey
      ? `${currentKey.substring(0, 8)}...${currentKey.substring(currentKey.length - 4)}`
      : '(not configured)';

    const action = await vscode.window.showInformationMessage(
      `${displayName} API Key: ${maskedKey}`,
      'Change Key',
      'Change Base URL',
      'Test Connection'
    );

    if (action === 'Change Key') {
      const newKey = await vscode.window.showInputBox({
        prompt: `Enter your ${displayName} API Key`,
        password: true,
        value: currentKey
      });

      if (newKey !== undefined) {
        await config.update('apiKey', newKey, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`${displayName} API Key updated ✅`);
      }
    }

    if (action === 'Change Base URL') {
      const currentUrl = config.get<string>('baseUrl', '');
      const newUrl = await vscode.window.showInputBox({
        prompt: `${displayName} API Base URL`,
        value: currentUrl
      });

      if (newUrl !== undefined) {
        await config.update('baseUrl', newUrl, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`${displayName} Base URL updated ✅`);
      }
    }

    if (action === 'Test Connection') {
      await testProviderConnection(providerName);
    }
  }

  async function testProviderConnection(providerName: string) {
    const config = vscode.workspace.getConfiguration(providerName);
    const apiKey = config.get<string>('apiKey', '');
    const baseUrl = config.get<string>('baseUrl', '');
    const displayNames: Record<string, string> = {
      mimo: 'MiMo',
      kimi: 'Kimi',
      deepseek: 'DeepSeek',
      claude: 'Claude'
    };
    const displayName = displayNames[providerName] || providerName;

    if (!apiKey) {
      vscode.window.showErrorMessage(`${displayName}: API Key not configured`);
      return;
    }

    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Testing ${displayName} connection...`,
        cancellable: true
      }, async () => {
        const provider = factory.get(providerName);
        if (!provider) {
          throw new Error(`Provider ${displayName} not found`);
        }

        const available = await provider.isAvailable();
        if (available) {
          const models = provider.models.map(m => m.name).join(', ');
          vscode.window.showInformationMessage(`${displayName}: Connected ✅ — ${models}`);
        } else {
          vscode.window.showErrorMessage(`${displayName}: Connection failed ❌`);
        }
      });
    } catch (error: any) {
      vscode.window.showErrorMessage(`${displayName}: Connection error — ${error.message}`);
    }
  }

  // Test all connections command
  context.subscriptions.push(
    vscode.commands.registerCommand('mimo.test', async () => {
      for (const provider of factory.getAll()) {
        await testProviderConnection(provider.name);
      }
    })
  );

  // ========== UI COMMANDS ==========

  // Status bar button
  const statusBarBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarBtn.text = "$(mimo-logo)";
  statusBarBtn.tooltip = 'Open AI Orchestra Chat';
  statusBarBtn.command = 'mimo.openChat';
  statusBarBtn.show();
  context.subscriptions.push(statusBarBtn);

  // Orchestra status bar
  const orchestraBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  orchestraBtn.text = "🎼";
  orchestraBtn.tooltip = 'AI Orchestra: Execute Complex Task';
  orchestraBtn.command = 'orchestra.execute';
  orchestraBtn.show();
  context.subscriptions.push(orchestraBtn);

  // Open chat command
  context.subscriptions.push(
    vscode.commands.registerCommand('mimo.openChat', openChatPanel)
  );

  // New chat command
  context.subscriptions.push(
    vscode.commands.registerCommand('mimo.newChat', () => {
      chatViewProvider.clearHistory();
    })
  );

  // Clear history command
  context.subscriptions.push(
    vscode.commands.registerCommand('mimo.clearHistory', () => {
      chatViewProvider.clearHistory();
      vscode.window.showInformationMessage('Chat history cleared 🗑️');
    })
  );

  console.log('AI Orchestra extension activated');
}

function showOrchestraResult(result: any) {
  if (orchestraPanel) {
    orchestraPanel.reveal(vscode.ViewColumn.Two);
    return;
  }

  orchestraPanel = vscode.window.createWebviewPanel(
    'orchestra.result',
    '🎼 Orchestra Result',
    vscode.ViewColumn.Two,
    { enableScripts: true }
  );

  orchestraPanel.webview.html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, sans-serif; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
        h1 { color: #4fc1ff; }
        .stats { display: flex; gap: 20px; margin: 20px 0; }
        .stat { background: #252526; padding: 15px; border-radius: 8px; min-width: 120px; }
        .stat-label { color: #858585; font-size: 12px; }
        .stat-value { font-size: 24px; font-weight: bold; color: #4fc1ff; }
        .subtask { background: #252526; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 3px solid #4fc1ff; }
        .success { border-left-color: #4ec9b0; }
        .error { border-left-color: #f48771; }
        pre { background: #1e1e1e; padding: 15px; border-radius: 4px; overflow-x: auto; }
        code { font-family: 'Courier New', monospace; }
      </style>
    </head>
    <body>
      <h1>🎼 Orchestra Execution Result</h1>
      <div class="stats">
        <div class="stat">
          <div class="stat-label">Cost</div>
          <div class="stat-value">$${result.totalCost.toFixed(2)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Tokens</div>
          <div class="stat-value">${result.totalTokens.toLocaleString()}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Duration</div>
          <div class="stat-value">${(result.totalDuration / 1000).toFixed(1)}s</div>
        </div>
      </div>
      <h2>Work Orders (${result.workOrders.length} agents executed)</h2>
      ${result.workOrders.map((w: any) => `
        <div class="subtask ${w.status === 'done' ? 'success' : 'error'}">
          <strong>${w.id}: ${w.title}</strong> — ${w.status.toUpperCase()}
          <br><small>Agent: <code>${w.assignedTo || 'unassigned'}</code> · Role: ${w.role} · Iterations: ${w.result?.iterations ?? 0}</small>
          <br><small>Files modified: ${w.result?.filesModified.join(', ') || 'none'}</small>
          <br><small>Tools: ${w.result?.toolsUsed.join(', ') || 'none'}</small>
          <br><small>Tokens: ${(w.result?.tokensUsed ?? 0).toLocaleString()} · Cost: $${(w.result?.cost ?? 0).toFixed(4)} · Time: ${((w.result?.duration ?? 0) / 1000).toFixed(1)}s</small>
          <details><summary>Acceptance criteria (${w.acceptanceCriteria.length})</summary><ul>${w.acceptanceCriteria.map((c: string) => `<li>${escapeHtml(c)}</li>`).join('')}</ul></details>
          <pre><code>${escapeHtml((w.result?.finalText ?? '').substring(0, 600))}${(w.result?.finalText ?? '').length > 600 ? '...' : ''}</code></pre>
        </div>
      `).join('')}
      ${result.securityReview ? `
        <h2>Security Review (${result.securityReview.agentId})</h2>
        <div class="subtask ${result.securityReview.approved ? 'success' : 'error'}">
          <strong>${result.securityReview.approved ? '✅ APPROVED' : '⚠️ ISSUES FOUND'}</strong>
          <p>${escapeHtml(result.securityReview.summary)}</p>
          ${result.securityReview.issues.length > 0 ? `
            <h4>${result.securityReview.issues.length} issue(s)</h4>
            <ul>${result.securityReview.issues.map((i: any) => `
              <li><strong>[${i.severity}]</strong> ${escapeHtml(i.category)} — ${escapeHtml(i.description)}<br>
              <small>${i.fileRef ? escapeHtml(i.fileRef) : 'no file'} → ${escapeHtml(i.recommendation)}</small></li>
            `).join('')}</ul>
          ` : ''}
        </div>
      ` : ''}
      <h2>Inter-agent communication (${result.mailboxStats.totalSent} messages)</h2>
      <p>Conversations: ${result.mailboxStats.conversations} · Delivered: ${result.mailboxStats.totalDelivered}</p>
      ${result.conversationLog.length > 0 ? `
        <details><summary>Full conversation log</summary>
        ${result.conversationLog.map((m: any) => `
          <div class="subtask"><strong>[${m.type}] ${m.from} → ${m.to}</strong><br>
          <small>${m.subject}</small><br>
          <pre><code>${escapeHtml(m.body.substring(0, 400))}</code></pre></div>
        `).join('')}</details>
      ` : ''}
      <h2>Pool usage</h2>
      <pre><code>${escapeHtml(JSON.stringify(result.poolUsage, null, 2))}</code></pre>
      <h2>Final Report</h2>
      <pre><code>${escapeHtml(result.finalOutput)}</code></pre>
    </body>
    </html>
  `;

  orchestraPanel.onDidDispose(() => {
    orchestraPanel = undefined;
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
