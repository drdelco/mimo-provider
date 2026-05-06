/**
 * OrchestraView — Sidebar webview that visualizes a live orchestration.
 *
 * Receives DirectorEvents (plan-start, wo-start, wo-progress, wo-done, mail,
 * security-*, synthesize-*) and renders them as a real-time activity feed:
 *
 *   - One card per agent, color-coded by status (thinking/tool/done/failed)
 *   - Live event log per agent (tool calls, results, text deltas)
 *   - Inter-agent messages shown inline in the timeline
 *   - Phase headers (Planning → Executing → Security → Synthesis)
 *   - Final security review block with severity-tagged issues
 *   - Stat bar: total cost, tokens, elapsed time, agent count
 *
 * The view is registered as `mimo.orchestraView` in the sidebar. A "Run"
 * button triggers the orchestra.execute command.
 */

import * as vscode from 'vscode';
import { DirectorEvent, OrchestrationResult } from './Director';

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
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'execute') {
        vscode.commands.executeCommand('orchestra.execute');
      }
    });
  }

  /** Send a Director event to the webview */
  postEvent(event: DirectorEvent): void {
    this.view?.webview.postMessage(event);
  }

  /** Reset the view (clear all state) */
  reset(): void {
    this.view?.webview.postMessage({ type: 'reset' });
  }

  /** Send the final result so the view can render the report + security review */
  postFinal(result: OrchestrationResult): void {
    this.view?.webview.postMessage({
      type: 'final',
      finalOutput: result.finalOutput,
      totalTokens: result.totalTokens,
      totalCost: result.totalCost,
      securityReview: result.securityReview
    });
  }

  /** Reveal the view in the sidebar */
  reveal(): void {
    this.view?.show?.(true);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'orchestra.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'orchestra.js'));

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
    <h2>🎼 Orchestra</h2>
    <div class="stats">
      <span><strong id="stat-agents">0</strong> agents</span>
      <span><strong id="stat-tokens">0</strong> tokens</span>
      <span><strong id="stat-cost">$0.0000</strong></span>
      <span><strong id="stat-elapsed">0s</strong></span>
    </div>
  </div>
  <div class="toolbar">
    <button id="btn-run">▶ Execute Task</button>
    <button id="btn-clear" class="secondary">Clear</button>
    <span id="stat-request" style="font-size:11px;color:var(--vscode-descriptionForeground);align-self:center;flex:1;text-align:right">idle</span>
  </div>
  <div class="main" id="main"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) nonce += chars[Math.floor(Math.random() * chars.length)];
    return nonce;
  }
}
