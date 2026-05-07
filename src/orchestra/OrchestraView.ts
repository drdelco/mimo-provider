/**
 * OrchestraView — Webview that visualizes a live orchestration in real time.
 *
 * Two surfaces:
 *
 *   1. OrchestraViewProvider — the sidebar view (`mimo.orchestraView`).
 *      Always available, compact, has a "▶ Execute Task" button.
 *
 *   2. OrchestraLivePanel — a full editor-tab panel that opens automatically
 *      when an orchestration starts. Big, easy to find, updates live, shows
 *      the final report inline at the end. This is the primary surface
 *      during a run; the sidebar is a fallback.
 *
 * Both surfaces share the same HTML/CSS/JS (media/orchestra.{css,js}) and
 * receive the same DirectorEvent stream.
 */

import * as vscode from 'vscode';
import { DirectorEvent, OrchestrationResult } from './Director';

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) nonce += chars[Math.floor(Math.random() * chars.length)];
  return nonce;
}

function buildOrchestraHtml(webview: vscode.Webview, extensionUri: vscode.Uri, isPanel: boolean): string {
  const nonce = getNonce();
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'orchestra.css'));
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'orchestra.js'));

  // The execute button is only meaningful in the sidebar — in the live panel
  // the orchestration is already running, so hide it.
  const toolbarRunButton = isPanel
    ? ''
    : '<button id="btn-run">▶ Execute Task</button>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link href="${cssUri}" rel="stylesheet">
  <title>Orchestra</title>
</head>
<body>
  <div class="header">
    <h2>🎼 Orchestra${isPanel ? ' — Live' : ''}</h2>
    <div class="stats">
      <span><strong id="stat-agents">0</strong> agents</span>
      <span><strong id="stat-tokens">0</strong> tokens</span>
      <span><strong id="stat-cost">$0.0000</strong></span>
      <span><strong id="stat-elapsed">0s</strong></span>
    </div>
  </div>
  <div class="toolbar">
    ${toolbarRunButton}
    <button id="btn-clear" class="secondary">Clear</button>
    <span id="stat-request" style="font-size:11px;color:var(--vscode-descriptionForeground);align-self:center;flex:1;text-align:right">idle</span>
  </div>
  <div class="main" id="main"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}

/**
 * Sidebar webview view (compact, always available).
 */
export class OrchestraViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'mimo.orchestraView';
  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    webviewView.webview.html = buildOrchestraHtml(webviewView.webview, this.extensionUri, false);

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'execute') {
        vscode.commands.executeCommand('orchestra.execute');
      }
    });
  }

  postEvent(event: DirectorEvent): void {
    this.view?.webview.postMessage(event);
  }

  reset(): void {
    this.view?.webview.postMessage({ type: 'reset' });
  }

  postFinal(result: OrchestrationResult): void {
    this.view?.webview.postMessage({
      type: 'final',
      finalOutput: result.finalOutput,
      totalTokens: result.totalTokens,
      totalCost: result.totalCost,
      securityReview: result.securityReview
    });
  }

  reveal(): void {
    this.view?.show?.(true);
  }
}

/**
 * Full editor-tab panel for live orchestration. Created on demand when a run
 * starts so the user immediately sees a visible, prominent activity stream.
 */
export class OrchestraLivePanel {
  private panel: vscode.WebviewPanel;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.panel = vscode.window.createWebviewPanel(
      'orchestra.live',
      '🎼 Orchestra — Live',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );
    this.panel.webview.html = buildOrchestraHtml(this.panel.webview, extensionUri, true);
  }

  postEvent(event: DirectorEvent): void {
    this.panel.webview.postMessage(event);
  }

  reset(): void {
    this.panel.webview.postMessage({ type: 'reset' });
  }

  postFinal(result: OrchestrationResult): void {
    this.panel.webview.postMessage({
      type: 'final',
      finalOutput: result.finalOutput,
      totalTokens: result.totalTokens,
      totalCost: result.totalCost,
      securityReview: result.securityReview
    });
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Two);
  }

  dispose(): void {
    this.panel.dispose();
  }
}
