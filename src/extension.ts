/**
 * MiMonster Orchestra — VS Code / Antigravity extension entry point.
 *
 * Two modes coexist:
 *
 *   1. Single-agent chat (stable, polished — uses MiMoProvider with
 *      cross-provider fallback to Kimi/DeepSeek/MiniMax/Claude). Sidebar
 *      view "mimo.chatView" + multi-tab chat panels with persistence.
 *
 *   2. Multi-agent Orchestra (autonomous: architect plans, agents execute
 *      in parallel, security reviews). Sidebar view "mimo.orchestraView"
 *      + command "orchestra.execute".
 */

import * as vscode from 'vscode';
import { MiMoProvider, fetchModelsFromApi } from './provider';
import { MiMoChatParticipant } from './chat';
import { MiMoChatViewProvider } from './webview';
import { initOAuth, loginWithOAuth, logoutOAuth, getOAuthStatus } from './oauth';
import { CodingDirector, OrchestrationResult } from './orchestra/Director';
import { AgentPool, DEFAULT_LIMITS } from './orchestra/AgentPool';
import { OrchestraViewProvider } from './orchestra/OrchestraView';

const panels = new Map<number, { panel: vscode.WebviewPanel; provider: MiMoChatViewProvider }>();
let orchestraResultPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  let panelCounter = 0;

  // OAuth secret storage
  initOAuth(context.secrets);

  // Pre-fetch models on activation (non-blocking)
  fetchModelsFromApi().then(models => {
    console.log(`MiMonster: ${models.length} models loaded`);
  });

  // ----- Single-agent chat: model provider, chat participant, sidebar -----
  const provider = new MiMoProvider();
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('mimo', provider)
  );

  const chat = new MiMoChatParticipant();
  context.subscriptions.push(chat.register(context));

  const sidebarProvider = new MiMoChatViewProvider(context.extensionUri);
  sidebarProvider.setExtensionContext(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('mimo.chatView', sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // ----- Orchestra: sidebar view for live multi-agent activity -----
  const orchestraView = new OrchestraViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('mimo.orchestraView', orchestraView, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // ----- Multi-tab chat panel persistence (from master) -----
  function persistOpenTabs() {
    const openIds = [...panels.keys()];
    context.workspaceState.update('mimo.openTabs', openIds);
  }

  function wireTab(id: number, panel: vscode.WebviewPanel, tabProvider: MiMoChatViewProvider) {
    tabProvider.setTabId(id);
    tabProvider.setExtensionContext(context);
    tabProvider.setActiveWebview(panel.webview);

    panel.webview.postMessage({ type: 'init', tabId: id });

    if (tabProvider.hasHistory()) {
      panel.webview.postMessage({ type: 'restored', messages: tabProvider.getHistoryForRestore() });
    }

    panel.webview.onDidReceiveMessage((message) => tabProvider.handleWebviewMessage(message));

    panel.onDidDispose(() => {
      panels.delete(id);
      persistOpenTabs();
    });

    panels.set(id, { panel, provider: tabProvider });
    persistOpenTabs();
  }

  function openNewChatPanel() {
    if (panels.size === 0) panelCounter = 0;
    panelCounter++;
    const id = panelCounter;

    const tabProvider = new MiMoChatViewProvider(context.extensionUri);
    const panel = vscode.window.createWebviewPanel(
      'mimo.chatPanel',
      `MiMonster #${id}`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [context.extensionUri] }
    );
    panel.webview.html = tabProvider.getHtml(panel.webview);
    wireTab(id, panel, tabProvider);
  }

  // Restore tab counter from saved tabs
  const savedTabs = context.workspaceState.get<number[]>('mimo.openTabs', []);
  if (savedTabs.length > 0) panelCounter = Math.max(...savedTabs);

  // Webview panel serializer for restored tabs across sessions
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

  // ----- mimo.* commands -----
  context.subscriptions.push(
    vscode.commands.registerCommand('mimo.openChat', openNewChatPanel)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mimo.newChat', () => sidebarProvider.clearHistory())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mimo.clearHistory', () => sidebarProvider.clearHistory())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mimo.manage', async () => {
      const config = vscode.workspace.getConfiguration('mimo');
      const currentKey = config.get<string>('apiKey', '');
      const masked = currentKey
        ? `${currentKey.substring(0, 8)}...${currentKey.substring(currentKey.length - 4)}`
        : '(not configured)';

      const action = await vscode.window.showInformationMessage(
        `MiMo API Key: ${masked}`,
        'Change Key', 'Test Connection', 'New Chat Tab'
      );

      if (action === 'Change Key') {
        const newKey = await vscode.window.showInputBox({
          prompt: 'Enter your MiMo API Key (tp-... for Token Plan, sk-... for API)',
          password: true, value: currentKey, placeHolder: 'tp-... or sk-...'
        });
        if (newKey !== undefined) {
          await config.update('apiKey', newKey, vscode.ConfigurationTarget.Global);
          await config.update('apiKey', newKey, vscode.ConfigurationTarget.Workspace);
          vscode.window.showInformationMessage('MiMo API Key updated');
        }
      }
      if (action === 'Test Connection') await vscode.commands.executeCommand('mimo.test');
      if (action === 'New Chat Tab') openNewChatPanel();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mimo.test', async () => {
      const config = vscode.workspace.getConfiguration('mimo');
      const apiKey = config.get<string>('apiKey', '');
      const baseUrl = config.get<string>('baseUrl', 'https://token-plan-ams.xiaomimimo.com/v1');
      if (!apiKey) {
        vscode.window.showErrorMessage('MiMonster: API Key not configured');
        return;
      }
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Testing MiMonster...', cancellable: true },
          async () => {
            const response = await fetch(`${baseUrl}/models`, {
              headers: { 'Authorization': `Bearer ${apiKey}` },
              signal: AbortSignal.timeout(10000)
            });
            if (response.ok) {
              const data = await response.json() as any;
              const models = data.data?.map((m: any) => m.id).join(', ') || 'unknown';
              vscode.window.showInformationMessage(`MiMonster: Connected — ${models}`);
            } else {
              vscode.window.showErrorMessage(`MiMonster: Error ${response.status}`);
            }
          }
        );
      } catch (error: any) {
        vscode.window.showErrorMessage(`MiMonster: ${error.message}`);
      }
    })
  );

  // ----- OAuth login commands -----
  context.subscriptions.push(
    vscode.commands.registerCommand('mimo.loginKimi', async () => {
      try { await loginWithOAuth('kimi'); fetchModelsFromApi(); } catch { /* error already shown */ }
    }),
    vscode.commands.registerCommand('mimo.loginMiniMax', async () => {
      try { await loginWithOAuth('minimax'); fetchModelsFromApi(); } catch { /* error already shown */ }
    }),
    vscode.commands.registerCommand('mimo.logoutKimi', async () => { await logoutOAuth('kimi'); }),
    vscode.commands.registerCommand('mimo.logoutMiniMax', async () => { await logoutOAuth('minimax'); }),
    vscode.commands.registerCommand('mimo.oauthStatus', async () => {
      const kimi = await getOAuthStatus('kimi');
      const mm = await getOAuthStatus('minimax');
      const lines: string[] = [];
      lines.push(`**Kimi (Moonshot):** ${kimi.loggedIn ? '✅ Logged in' : '❌ Not logged in'}`);
      if (kimi.expiresAt) lines.push(`  Expires: ${new Date(kimi.expiresAt).toLocaleString()}`);
      lines.push('');
      lines.push(`**MiniMax:** ${mm.loggedIn ? '✅ Logged in' : '❌ Not logged in'}`);
      if (mm.expiresAt) lines.push(`  Expires: ${new Date(mm.expiresAt).toLocaleString()}`);
      vscode.window.showInformationMessage(lines.join('\n'), { modal: true });
    })
  );

  // ----- Orchestra commands -----
  context.subscriptions.push(
    vscode.commands.registerCommand('orchestra.execute', async () => {
      const request = await vscode.window.showInputBox({
        prompt: 'Describe the complex coding task',
        placeHolder: 'e.g. "Add JWT authentication with refresh tokens, role-based access, and rate limiting"',
        validateInput: (v) => v ? null : 'Please enter a task description'
      });
      if (!request) return;

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
      const orchestraConfig = vscode.workspace.getConfiguration('orchestra');
      const poolLimits = orchestraConfig.get<Record<string, number>>('poolLimits') ?? DEFAULT_LIMITS;
      const budget = orchestraConfig.get<number>('budgetLimit') ?? 5.0;
      const autoFallback = orchestraConfig.get<boolean>('autoFallback') ?? true;
      const skipSecurityReview = orchestraConfig.get<boolean>('skipSecurityReview') ?? false;

      // Pick a sandbox directory so agents do not pollute the active workspace.
      // Default: <workspace>/.orchestra-runs/<timestamp-slug>/
      // User can override via input box.
      const fs = require('fs') as typeof import('fs');
      const path = require('path') as typeof import('path');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const slug = request.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 30);
      const defaultSandbox = path.join(workspaceRoot, '.orchestra-runs', `${ts}-${slug}`);

      const sandboxChoice = await vscode.window.showInputBox({
        prompt: 'Where should the agents write their output? (Empty = default sandbox)',
        value: defaultSandbox,
        valueSelection: [0, defaultSandbox.length]
      });
      if (sandboxChoice === undefined) return; // user cancelled

      const sandboxRoot = sandboxChoice.trim() || defaultSandbox;
      try {
        fs.mkdirSync(sandboxRoot, { recursive: true });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Cannot create sandbox at ${sandboxRoot}: ${err.message}`);
        return;
      }

      const pool = new AgentPool(poolLimits);
      const director = new CodingDirector(sandboxRoot, budget, pool, { autoFallback, skipSecurityReview });

      // Stream live events to the sidebar view
      orchestraView.reveal();
      orchestraView.reset();
      director.setEventListener((e) => orchestraView.postEvent(e));

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'MiMonster Orchestra',
        cancellable: true
      }, async (progress) => {
        try {
          const result = await director.execute(request, progress);
          orchestraView.postFinal(result);
          showOrchestraResultPanel(result);

          const securityStatus = result.securityReview
            ? (result.securityReview.approved ? 'security ✅' : `security ⚠️ ${result.securityReview.issues.length} issues`)
            : 'security skipped';
          vscode.window.showInformationMessage(
            `Orchestra: $${result.totalCost.toFixed(4)} · ${(result.totalDuration / 1000).toFixed(1)}s · ${securityStatus}`,
            'View Details'
          );
        } catch (error: any) {
          vscode.window.showErrorMessage(`Orchestra failed: ${error.message}`);
        }
      });
    }),
    vscode.commands.registerCommand('orchestra.status', async () => {
      // Use a transient director just to query availability
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
      const director = new CodingDirector(workspaceRoot);
      // Force-load by trying to execute a no-op... actually just expose providers
      // The Director registers all providers on construction. We hit isAvailable for each.
      vscode.window.showInformationMessage(
        'Use the Orchestra sidebar to see live status. Configure missing API keys via Settings.'
      );
      void director; // suppress unused
    })
  );

  // ----- Status bar buttons -----
  const statusChat = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusChat.text = '$(mimo-logo) MiMonster';
  statusChat.tooltip = 'Open MiMonster Chat';
  statusChat.command = 'mimo.openChat';
  statusChat.show();
  context.subscriptions.push(statusChat);

  const statusOrchestra = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  statusOrchestra.text = '🎼 Orchestra';
  statusOrchestra.tooltip = 'Run multi-agent orchestration';
  statusOrchestra.command = 'orchestra.execute';
  statusOrchestra.show();
  context.subscriptions.push(statusOrchestra);

  console.log('MiMonster Orchestra activated');
}

function showOrchestraResultPanel(result: OrchestrationResult) {
  if (orchestraResultPanel) {
    orchestraResultPanel.reveal(vscode.ViewColumn.Two);
  } else {
    orchestraResultPanel = vscode.window.createWebviewPanel(
      'orchestra.result',
      'Orchestra Result',
      vscode.ViewColumn.Two,
      { enableScripts: true }
    );
    orchestraResultPanel.onDidDispose(() => { orchestraResultPanel = undefined; });
  }

  orchestraResultPanel.webview.html = renderResultHtml(result);
}

function renderResultHtml(result: OrchestrationResult): string {
  return `<!DOCTYPE html>
<html><head><style>
  body { font-family: -apple-system, sans-serif; padding: 20px; background: #1e1e1e; color: #d4d4d4; line-height: 1.5; }
  h1 { color: #4fc1ff; }
  h2 { color: #d4d4d4; border-bottom: 1px solid #333; padding-bottom: 4px; margin-top: 24px; }
  .stats { display: flex; gap: 12px; margin: 16px 0; flex-wrap: wrap; }
  .stat { background: #252526; padding: 12px 16px; border-radius: 6px; min-width: 120px; }
  .stat-label { color: #858585; font-size: 11px; text-transform: uppercase; }
  .stat-value { font-size: 20px; font-weight: 600; color: #4fc1ff; }
  .wo { background: #252526; padding: 12px; margin: 8px 0; border-radius: 4px; border-left: 3px solid #4fc1ff; }
  .wo.done { border-left-color: #4ec9b0; }
  .wo.failed { border-left-color: #f48771; }
  .sec { background: rgba(255, 165, 0, 0.1); padding: 12px; border-radius: 4px; border: 1px solid #ff9500; }
  .sec.approved { background: rgba(78, 201, 176, 0.1); border-color: #4ec9b0; }
  .issue { padding: 6px; margin: 4px 0; border-left: 2px solid #f48771; }
  .issue.critical { border-left-color: #f48771; }
  .issue.high { border-left-color: #ff9500; }
  .issue.medium { border-left-color: #d7ba7d; }
  .issue.low { border-left-color: #4fc1ff; }
  .severity { display: inline-block; font-size: 10px; padding: 1px 6px; background: #333; border-radius: 3px; margin-right: 6px; text-transform: uppercase; }
  pre { background: #1e1e1e; padding: 12px; border-radius: 4px; overflow-x: auto; font-family: 'Cascadia Code', monospace; font-size: 12px; white-space: pre-wrap; }
  small { color: #858585; }
  details { margin-top: 6px; }
  summary { cursor: pointer; color: #858585; font-size: 11px; }
</style></head><body>
  <h1>🎼 MiMonster Orchestra Result</h1>
  <p><small>Sandbox: <code>${escape(result.sandboxRoot)}</code></small></p>
  <div class="stats">
    <div class="stat"><div class="stat-label">Cost</div><div class="stat-value">$${result.totalCost.toFixed(4)}</div></div>
    <div class="stat"><div class="stat-label">Tokens</div><div class="stat-value">${result.totalTokens.toLocaleString()}</div></div>
    <div class="stat"><div class="stat-label">Duration</div><div class="stat-value">${(result.totalDuration / 1000).toFixed(1)}s</div></div>
    <div class="stat"><div class="stat-label">Agents</div><div class="stat-value">${result.workOrders.length}</div></div>
    <div class="stat"><div class="stat-label">Messages</div><div class="stat-value">${result.mailboxStats.totalSent}</div></div>
  </div>

  <h2>Work Orders (${result.workOrders.length})</h2>
  ${result.workOrders.map(w => `
    <div class="wo ${w.status}">
      <strong>${w.id}: ${escape(w.title)}</strong> — ${w.status.toUpperCase()}<br>
      <small>Agent: <code>${w.assignedTo || 'unassigned'}</code> · Role: ${w.role} · ${w.result?.iterations ?? 0} iterations</small><br>
      <small>Files modified: ${(w.result?.filesModified ?? []).join(', ') || 'none'}</small><br>
      <small>Tools: ${(w.result?.toolsUsed ?? []).join(', ') || 'none'}</small><br>
      <small>$${(w.result?.cost ?? 0).toFixed(4)} · ${(w.result?.tokensUsed ?? 0).toLocaleString()} tok · ${((w.result?.duration ?? 0) / 1000).toFixed(1)}s</small>
      <details><summary>Acceptance criteria (${w.acceptanceCriteria.length})</summary><ul>${w.acceptanceCriteria.map(c => `<li>${escape(c)}</li>`).join('')}</ul></details>
      <pre>${escape((w.result?.finalText ?? '').substring(0, 800))}${(w.result?.finalText?.length ?? 0) > 800 ? '...' : ''}</pre>
    </div>`).join('')}

  ${result.securityReview ? `
    <h2>Security Review</h2>
    <div class="sec ${result.securityReview.approved ? 'approved' : ''}">
      <strong>${result.securityReview.approved ? '✅ APPROVED' : '⚠️ ISSUES FOUND'}</strong> · auditor ${result.securityReview.agentId}
      <p>${escape(result.securityReview.summary)}</p>
      ${result.securityReview.issues.map(i => `
        <div class="issue ${i.severity}"><span class="severity">${escape(i.severity)}</span>
          <strong>${escape(i.category)}</strong> — ${escape(i.description)}<br>
          <small>${i.fileRef ? escape(i.fileRef) : 'no file'} → ${escape(i.recommendation)}</small>
        </div>`).join('')}
    </div>` : ''}

  <h2>Inter-agent communication</h2>
  <p>Total messages: ${result.mailboxStats.totalSent} · Conversations: ${result.mailboxStats.conversations}</p>
  ${result.conversationLog.length > 0 ? `<details><summary>Full conversation log (${result.conversationLog.length} messages)</summary>
    ${result.conversationLog.map(m => `
      <div class="wo"><small>[${m.type}] <code>${m.from}</code> → <code>${m.to}</code> · ${escape(m.subject)}</small>
        <pre>${escape(m.body.substring(0, 400))}</pre></div>`).join('')}</details>` : '<p><em>No inter-agent messages.</em></p>'}

  <h2>Pool concurrency</h2>
  <pre>${escape(JSON.stringify(result.poolUsage, null, 2))}</pre>

  <h2>Vector memory</h2>
  <pre>${escape(JSON.stringify(result.memoryStats, null, 2))}</pre>

  <h2>Final report</h2>
  <pre>${escape(result.finalOutput)}</pre>
</body></html>`;
}

function escape(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export function deactivate() {}
