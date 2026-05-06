/**
 * CodingDirector — Multi-agent orchestration with WorkOrders + Mailbox + Security Review.
 *
 * Pipeline:
 *   1. PLAN     — Architect emits a list of WorkOrders (with deps, deliverables, criteria)
 *   2. EXECUTE  — DAG executor runs WorkOrders in parallel via Promise.all per batch.
 *                 Each WorkOrder is handed to an AgentExecutor with:
 *                   - the rendered WorkOrder spec
 *                   - access to the Mailbox (ask_agent, notify, broadcast, check_inbox)
 *                   - knowledge of peer agent IDs
 *   3. SECURITY — A mandatory security reviewer audits the full set of changes.
 *                 If it finds critical issues, they appear in the final report.
 *   4. SYNTHESIS — Architect produces a unified final report.
 *
 * The Mailbox is a single shared instance; agents can communicate at any time
 * during step 2 (and with the security reviewer during step 3).
 */

import * as vscode from 'vscode';
import { AICodingProvider, ChatMessage } from '../providers/BaseProvider';
import { ProviderFactory } from '../providers/BaseProvider';
import { MiMoProvider } from '../providers/MiMoProvider';
import { KimiProvider } from '../providers/KimiProvider';
import { DeepSeekProvider } from '../providers/DeepSeekProvider';
import { ClaudeProvider } from '../providers/ClaudeProvider';
import { MiniMaxProvider } from '../providers/MiniMaxProvider';
import { AgentExecutor, AgentEvent } from './AgentExecutor';
import { AgentPool } from './AgentPool';
import { AgentMailbox, AgentMessage } from './Mailbox';
import { VectorMemory } from './VectorMemory';
import {
  WorkOrder,
  WorkOrderResult,
  buildWorkOrder,
  buildWorkOrderResult,
  renderWorkOrderForAgent
} from './WorkOrder';

export type AgentRole = 'architect' | 'coder' | 'reviewer' | 'optimizer' | 'debugger' | 'tester' | 'security';

export interface OrchestrationResult {
  success: boolean;
  workOrders: WorkOrder[];
  securityReview?: SecurityReviewResult;
  finalOutput: string;
  totalCost: number;
  totalTokens: number;
  totalDuration: number;
  poolUsage: Record<string, { inUse: number; limit: number; waiting: number }>;
  mailboxStats: ReturnType<AgentMailbox['stats']>;
  conversationLog: AgentMessage[];
  memoryStats: ReturnType<VectorMemory['stats']>;
  sandboxRoot: string;
}

export interface SecurityReviewResult {
  agentId: string;
  approved: boolean;
  issues: SecurityIssue[];
  summary: string;
  duration: number;
  cost: number;
}

export interface SecurityIssue {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  description: string;
  fileRef?: string;
  recommendation: string;
}

export type DirectorEvent =
  | { type: 'plan-start'; request: string }
  | { type: 'plan-done'; workOrderCount: number }
  | { type: 'wo-start'; workOrderId: string; agentId: string; role: string; title: string }
  | { type: 'wo-progress'; workOrderId: string; agentId: string; event: AgentEvent }
  | { type: 'wo-done'; workOrderId: string; agentId: string; success: boolean; duration: number; cost: number }
  | { type: 'mail'; message: AgentMessage }
  | { type: 'security-start'; filesToReview: string[] }
  | { type: 'security-done'; approved: boolean; issueCount: number }
  | { type: 'synthesize-start' }
  | { type: 'synthesize-done' }
  | { type: 'budget-warning'; used: number; limit: number }
  | { type: 'wo-fallback'; workOrderId: string; failedProvider: string; nextProvider: string; reason: string };

export class TaskRouter {
  private agentRoles: Map<AgentRole, string[]> = new Map([
    ['architect', ['kimi', 'claude', 'minimax', 'mimo']],
    ['coder',     ['mimo', 'minimax', 'deepseek', 'kimi']],
    ['reviewer',  ['claude', 'kimi', 'minimax', 'mimo']],
    ['security',  ['claude', 'kimi', 'minimax', 'mimo']],
    ['optimizer', ['deepseek', 'mimo', 'minimax', 'kimi']],
    ['debugger',  ['mimo', 'claude', 'deepseek', 'minimax']],
    ['tester',    ['mimo', 'minimax', 'deepseek', 'kimi']]
  ]);

  selectProvider(role: AgentRole, available: AICodingProvider[]): AICodingProvider | undefined {
    return this.selectProviderChain(role, available)[0];
  }

  /**
   * Returns the ordered list of providers to try for this role, available-only.
   * Used by auto-fallback: if the first one fails, try the next.
   */
  selectProviderChain(role: AgentRole, available: AICodingProvider[]): AICodingProvider[] {
    const preferred = this.agentRoles.get(role) ?? [];
    const chain: AICodingProvider[] = [];
    for (const name of preferred) {
      const p = available.find(x => x.name === name);
      if (p) chain.push(p);
    }
    // Append any other available providers as last-resort fallbacks
    for (const p of available) {
      if (!chain.includes(p)) chain.push(p);
    }
    return chain;
  }

  describe(role: AgentRole): string {
    const map: Record<AgentRole, string> = {
      architect: 'a system architect — design and break down complex tasks',
      coder:     'a coder — implement code according to spec, using read_file/write_file/edit_file/run_terminal',
      reviewer:  'a code reviewer — analyze quality, correctness, and maintainability',
      security:  'a security auditor — find vulnerabilities (OWASP Top 10), unsafe patterns, secrets exposure, and unsafe shell/SQL/HTML usage',
      optimizer: 'a performance optimizer — identify and fix bottlenecks',
      debugger:  'a debugger — diagnose and fix bugs',
      tester:    'a test author — write and run tests using run_terminal'
    };
    return map[role];
  }
}

export class SharedMemory {
  private store: Map<string, string> = new Map();
  constructor(private workspaceRoot: string) {}

  add(key: string, content: string): void {
    this.store.set(key, content);
    try {
      const fs = require('fs');
      const path = require('path');
      const file = path.join(this.workspaceRoot, '.orchestra-context.md');
      const entry = `\n## ${key}\n${content}\n`;
      if (fs.existsSync(file)) fs.appendFileSync(file, entry);
      else fs.writeFileSync(file, `# Orchestra Context\n${entry}`);
    } catch { /* persistence is best-effort */ }
  }

  get(key: string): string | undefined { return this.store.get(key); }

  loadProjectContext(): string {
    const fs = require('fs');
    const path = require('path');
    const candidates = ['CLAUDE.md', '.cursorrules', '.mimo-context.md', '.orchestra-context.md', 'AGENTS.md'];
    let context = '';
    for (const f of candidates) {
      try {
        const p = path.join(this.workspaceRoot, f);
        if (fs.existsSync(p)) {
          context += `\n--- ${f} ---\n${fs.readFileSync(p, 'utf-8').substring(0, 5000)}\n`;
        }
      } catch { /* skip */ }
    }
    return context;
  }
}

export class CodingDirector {
  private factory: ProviderFactory;
  private router: TaskRouter;
  private memory: SharedMemory;
  private executor: AgentExecutor;
  private pool: AgentPool;
  private mailbox: AgentMailbox;
  private vectorMemory: VectorMemory;
  private budgetLimit: number;
  private usedBudget = 0;
  private onEvent?: (e: DirectorEvent) => void;
  private skipSecurityReview: boolean;

  private autoFallback: boolean;

  /**
   * Sandbox directory where every agent's filesystem operations resolve to.
   * Also where Mailbox/Context persistence files live. This is what keeps the
   * user's main workspace clean.
   */
  private sandboxRoot: string;

  constructor(
    sandboxRoot: string,
    budgetLimit: number = 5.0,
    pool?: AgentPool,
    options: { skipSecurityReview?: boolean; autoFallback?: boolean } = {}
  ) {
    this.sandboxRoot = sandboxRoot;
    this.factory = new ProviderFactory();
    this.router = new TaskRouter();
    this.memory = new SharedMemory(sandboxRoot);
    this.executor = new AgentExecutor();
    this.pool = pool ?? new AgentPool();
    this.mailbox = new AgentMailbox(sandboxRoot);
    this.vectorMemory = new VectorMemory();
    this.budgetLimit = budgetLimit;
    this.skipSecurityReview = options.skipSecurityReview ?? false;
    this.autoFallback = options.autoFallback ?? true;

    this.factory.register(new MiMoProvider());
    this.factory.register(new KimiProvider());
    this.factory.register(new DeepSeekProvider());
    this.factory.register(new MiniMaxProvider());
    this.factory.register(new ClaudeProvider());

    // Pipe mailbox messages to event listener for the UI + vector memory
    this.mailbox.subscribe((msg) => {
      this.emit({ type: 'mail', message: msg });
      this.vectorMemory.add({
        id: `msg-${msg.id}`,
        kind: 'message',
        text: `${msg.subject}\n\n${msg.body}`,
        metadata: { from: msg.from, to: msg.to, type: msg.type, workOrderId: msg.workOrderId }
      });
    });
  }

  setEventListener(handler: (e: DirectorEvent) => void): void {
    this.onEvent = handler;
  }

  getPoolUsage() { return this.pool.getAllUsage(); }
  getUsedBudget(): number { return this.usedBudget; }
  getBudgetLimit(): number { return this.budgetLimit; }
  getMailbox(): AgentMailbox { return this.mailbox; }
  getVectorMemory(): VectorMemory { return this.vectorMemory; }
  getSandboxRoot(): string { return this.sandboxRoot; }

  async execute(
    request: string,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<OrchestrationResult> {
    const startTime = Date.now();
    const available = await this.factory.getAvailable();
    if (available.length === 0) {
      throw new Error('No AI providers available. Configure at least one API key.');
    }

    // ---- Phase 1: PLAN ----
    progress?.report({ message: 'Architect drafting work orders...', increment: 5 });
    this.emit({ type: 'plan-start', request });
    const workOrders = await this.createWorkOrders(request, available);
    this.emit({ type: 'plan-done', workOrderCount: workOrders.length });
    progress?.report({ message: `Plan: ${workOrders.length} work orders`, increment: 5 });

    // ---- Phase 2: EXECUTE ----
    await this.executeWorkOrders(workOrders, available, progress);

    // ---- Phase 3: SECURITY REVIEW ----
    let securityReview: SecurityReviewResult | undefined;
    if (!this.skipSecurityReview) {
      const filesTouched = this.collectFilesTouched(workOrders);
      if (filesTouched.length > 0) {
        progress?.report({ message: 'Security audit...', increment: 80 });
        this.emit({ type: 'security-start', filesToReview: filesTouched });
        securityReview = await this.runSecurityReview(workOrders, filesTouched, available);
        this.emit({ type: 'security-done', approved: securityReview.approved, issueCount: securityReview.issues.length });
      }
    }

    // ---- Phase 4: SYNTHESIS ----
    this.emit({ type: 'synthesize-start' });
    progress?.report({ message: 'Synthesizing final report...', increment: 95 });
    const finalOutput = await this.synthesize(request, workOrders, securityReview, available);
    this.emit({ type: 'synthesize-done' });

    return {
      success: workOrders.every(w => w.status === 'done') && (securityReview?.approved ?? true),
      workOrders,
      securityReview,
      finalOutput,
      totalCost: workOrders.reduce((s, w) => s + (w.result?.cost ?? 0), 0) + (securityReview?.cost ?? 0),
      totalTokens: workOrders.reduce((s, w) => s + (w.result?.tokensUsed ?? 0), 0),
      totalDuration: Date.now() - startTime,
      poolUsage: this.pool.getAllUsage(),
      mailboxStats: this.mailbox.stats(),
      conversationLog: this.mailbox.history(),
      memoryStats: this.vectorMemory.stats(),
      sandboxRoot: this.sandboxRoot
    };
  }

  private async createWorkOrders(request: string, available: AICodingProvider[]): Promise<WorkOrder[]> {
    const architect = this.router.selectProvider('architect', available);
    if (!architect) throw new Error('No architect provider available');

    const context = this.memory.loadProjectContext();
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a system architect. Break the user's request into Work Orders for parallel execution by specialist agents.

Each Work Order must include:
- id: unique like "WO-001"
- title: short title
- description: detailed task description
- role: one of [coder, reviewer, optimizer, debugger, tester]
  (do NOT emit "security" — security review happens automatically as a final phase)
- dependsOn: array of WO ids that must complete first (use [] for parallel-able tasks)
- inputs: array of {type: "file"|"workorder"|"context", ref: string, label?: string}
- deliverables: concrete outputs (file paths, function names, behaviors)
- acceptanceCriteria: explicit testable checks for "done"

Guidelines:
- Aim for 2-6 Work Orders. Don't over-decompose.
- Use dependsOn: [] for tasks that can run in parallel.
- Acceptance criteria must be explicit ("file X compiles", "function Y returns Z when called with W").
- Deliverables must be concrete things that exist after the WO is done.

Respond ONLY with valid JSON, no markdown fences:
{
  "workOrders": [ ... ],
  "requirements": ["constraint1", ...]
}`
      },
      {
        role: 'user',
        content: `Project context:\n${context}\n\nRequest: ${request}`
      }
    ];

    let response = '';
    const stream = architect.chat({ model: architect.models[0].id, messages, stream: true, maxTokens: 4000 });
    for await (const chunk of stream) {
      if (chunk.content) response += chunk.content;
      if (chunk.done) break;
    }

    try {
      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(cleaned);
      const list = (parsed.workOrders ?? parsed.subtasks ?? []) as any[];
      return list.map((raw, idx) => buildWorkOrder(raw, idx));
    } catch {
      // Fallback: single coder WO
      return [buildWorkOrder({
        id: 'WO-001',
        title: request.substring(0, 60),
        description: request,
        role: 'coder',
        dependsOn: [],
        deliverables: ['Working implementation of the requested change'],
        acceptanceCriteria: ['Code compiles', 'No errors when run']
      }, 0)];
    }
  }

  private async executeWorkOrders(
    workOrders: WorkOrder[],
    available: AICodingProvider[],
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<void> {
    const results = new Map<string, WorkOrderResult>();
    const completed = new Set<string>();
    const remaining = new Map(workOrders.map(w => [w.id, w]));
    let completedCount = 0;
    const total = workOrders.length;

    while (remaining.size > 0) {
      const ready = [...remaining.values()].filter(w =>
        w.dependsOn.every(dep => completed.has(dep))
      );

      if (ready.length === 0) {
        for (const w of remaining.values()) {
          w.status = 'failed';
          w.result = {
            filesCreated: [], filesModified: [], toolsUsed: [],
            summary: 'Unsatisfiable dependency',
            iterations: 0, tokensUsed: 0, cost: 0, duration: 0,
            finalText: '', error: 'Unsatisfiable dependency'
          };
          completed.add(w.id);
        }
        break;
      }

      // Snapshot peers BEFORE the parallel batch (so peers list is stable per batch)
      const peerIds = [...workOrders.map(w => w.assignedTo).filter(Boolean) as string[]];

      progress?.report({
        message: `Running ${ready.length} WO(s) in parallel`,
        increment: 0
      });

      await Promise.all(ready.map(wo => this.runWorkOrder(wo, available, results, peerIds)));

      for (const wo of ready) {
        if (wo.result) {
          results.set(wo.id, wo.result);
          this.usedBudget += wo.result.cost;
          if (this.usedBudget > this.budgetLimit) {
            this.emit({ type: 'budget-warning', used: this.usedBudget, limit: this.budgetLimit });
            throw new Error(`Budget exceeded: $${this.usedBudget.toFixed(2)} / $${this.budgetLimit}`);
          }
          this.memory.add(`workorder-${wo.id}`, wo.result.summary);
          // Index the result so downstream agents can semantically retrieve it
          this.vectorMemory.add({
            id: `wo-${wo.id}`,
            kind: 'workorder',
            text: `${wo.title}\n${wo.description}\n${wo.result.finalText}`,
            metadata: {
              role: wo.role,
              agentId: wo.assignedTo,
              filesModified: wo.result.filesModified
            }
          });
        }
        completed.add(wo.id);
        remaining.delete(wo.id);
        completedCount++;

        const pct = Math.round((completedCount / total) * 60) + 15;
        progress?.report({ message: `${completedCount}/${total} work orders complete`, increment: pct });
      }
    }
  }

  private async runWorkOrder(
    wo: WorkOrder,
    available: AICodingProvider[],
    priorResults: Map<string, WorkOrderResult>,
    peerIds: string[]
  ): Promise<void> {
    const startTime = Date.now();
    wo.startedAt = startTime;
    wo.status = 'in-progress';

    const chain = this.router.selectProviderChain(wo.role, available);
    if (chain.length === 0) {
      wo.status = 'failed';
      wo.result = {
        filesCreated: [], filesModified: [], toolsUsed: [],
        summary: `No provider available for role ${wo.role}`,
        iterations: 0, tokensUsed: 0, cost: 0, duration: 0,
        finalText: '', error: 'No provider'
      };
      wo.endedAt = Date.now();
      return;
    }

    // Determine how many providers to try: just the first one, or the whole chain
    const providersToTry = this.autoFallback ? chain : chain.slice(0, 1);
    let lastError: string | undefined;
    let cumulativeCost = 0;

    for (let attempt = 0; attempt < providersToTry.length; attempt++) {
      const provider = providersToTry[attempt];
      const instance = await this.pool.acquire(provider, provider.models[0].id, wo.role);
      wo.assignedTo = instance.id;

      this.emit({
        type: 'wo-start',
        workOrderId: wo.id,
        agentId: instance.id,
        role: wo.role,
        title: wo.title
      });

      try {
        const projectContext = this.memory.loadProjectContext();
        const woSpec = renderWorkOrderForAgent(wo, priorResults);
        const peers = peerIds.filter(id => id !== instance.id);

        // Pull semantically relevant context from prior WOs and messages
        const semanticQuery = `${wo.title}\n${wo.description}\n${wo.deliverables.join('\n')}`;
        const semanticContext = this.vectorMemory.getRelevantContext(semanticQuery, 4, 2500);

        const fallbackNote = attempt > 0
          ? `\n\nNOTE: A previous attempt by ${providersToTry[attempt - 1].name} failed (${lastError}). You are taking over.`
          : '';

        const systemPrompt = `You are ${this.router.describe(wo.role)}.

You are agent: ${instance.id}
Other agents you can talk to via ask_agent / notify / broadcast: ${peers.join(', ') || '(none yet)'}${fallbackNote}

PROJECT CONTEXT:
${projectContext}

${semanticContext ? semanticContext + '\n\n' : ''}${woSpec}

When you finish, end with a brief summary covering each acceptance criterion.`;

        const result = await this.executor.run({
          provider,
          modelId: instance.modelId,
          systemPrompt,
          userTask: `Execute Work Order ${wo.id}: ${wo.title}\n\n${wo.description}`,
          maxIterations: 40,
          workspaceRoot: this.sandboxRoot,
          orchestraContext: {
            mailbox: this.mailbox,
            agentId: instance.id,
            peers,
            workOrderId: wo.id
          },
          onProgress: (event) => {
            this.emit({ type: 'wo-progress', workOrderId: wo.id, agentId: instance.id, event });
          }
        });

        const duration = Date.now() - startTime;
        const cost = provider.estimateCost(result.inputTokensEstimate, result.outputTokensEstimate, instance.modelId);
        cumulativeCost += cost;

        if (result.success) {
          wo.result = buildWorkOrderResult(result, duration, cumulativeCost);
          wo.status = 'done';
          wo.endedAt = Date.now();
          this.emit({
            type: 'wo-done',
            workOrderId: wo.id,
            agentId: instance.id,
            success: true,
            duration,
            cost
          });
          return;
        }

        // Failed — record error and try next provider in chain
        lastError = result.error ?? 'agent did not complete';
        this.emit({
          type: 'wo-done',
          workOrderId: wo.id,
          agentId: instance.id,
          success: false,
          duration,
          cost
        });

        if (attempt + 1 < providersToTry.length) {
          this.emit({
            type: 'wo-fallback',
            workOrderId: wo.id,
            failedProvider: provider.name,
            nextProvider: providersToTry[attempt + 1].name,
            reason: lastError
          });
        } else {
          // No more fallbacks — record the failure
          wo.result = buildWorkOrderResult(result, duration, cumulativeCost);
          wo.status = 'failed';
          wo.endedAt = Date.now();
        }
      } catch (err: any) {
        lastError = err.message;
        this.emit({
          type: 'wo-done',
          workOrderId: wo.id,
          agentId: instance.id,
          success: false,
          duration: Date.now() - startTime,
          cost: 0
        });
        if (attempt + 1 < providersToTry.length) {
          this.emit({
            type: 'wo-fallback',
            workOrderId: wo.id,
            failedProvider: provider.name,
            nextProvider: providersToTry[attempt + 1].name,
            reason: lastError ?? 'unknown error'
          });
        } else {
          wo.status = 'failed';
          wo.result = {
            filesCreated: [], filesModified: [], toolsUsed: [],
            summary: `All providers failed. Last error: ${lastError}`,
            iterations: 0, tokensUsed: 0, cost: cumulativeCost,
            duration: Date.now() - startTime,
            finalText: '', error: lastError
          };
          wo.endedAt = Date.now();
        }
      } finally {
        instance.release();
      }
    }
  }

  private async runSecurityReview(
    workOrders: WorkOrder[],
    filesTouched: string[],
    available: AICodingProvider[]
  ): Promise<SecurityReviewResult> {
    const startTime = Date.now();
    const provider = this.router.selectProvider('security', available);
    if (!provider) {
      return {
        agentId: 'none',
        approved: true,
        issues: [],
        summary: 'No security provider available — review skipped.',
        duration: 0,
        cost: 0
      };
    }

    const instance = await this.pool.acquire(provider, provider.models[0].id, 'security');
    try {
      const summary = workOrders.map(w =>
        `### ${w.id} — ${w.title} (${w.role}, ${w.assignedTo})\n` +
        `Status: ${w.status}\n` +
        `Files modified: ${w.result?.filesModified.join(', ') || 'none'}\n` +
        `Summary: ${w.result?.summary ?? 'no summary'}`
      ).join('\n\n');

      const systemPrompt = `You are a security auditor. Review the recent code changes.

Look for OWASP Top 10 issues:
- Injection (SQL, command, LDAP, OS)
- Broken authentication / session
- Sensitive data exposure (secrets in code, logging credentials)
- XML External Entities (XXE)
- Broken access control
- Security misconfiguration
- Cross-site scripting (XSS)
- Insecure deserialization
- Components with known vulnerabilities
- Insufficient logging & monitoring

Also flag:
- Hardcoded credentials, API keys, tokens
- Unsafe \`eval\`, \`exec\`, \`Function()\`
- Unsanitized input passed to shell or DB
- Permissive CORS
- Disabled TLS verification

Use read_file to inspect each modified file.

When done, respond with this EXACT JSON format (no markdown fences):
{
  "approved": true|false,
  "issues": [
    {
      "severity": "critical|high|medium|low|info",
      "category": "...",
      "description": "...",
      "fileRef": "path/to/file.ts:line",
      "recommendation": "..."
    }
  ],
  "summary": "Overall security assessment in 2-3 sentences"
}

approved=false if there is at least one critical or high severity issue.`;

      const userTask = `Audit these recent changes from the orchestration:

Files modified across the orchestration:
${filesTouched.map(f => `- ${f}`).join('\n')}

Work Orders summary:
${summary}

Read each modified file and produce the JSON audit report.`;

      const result = await this.executor.run({
        provider,
        modelId: instance.modelId,
        systemPrompt,
        userTask,
        maxIterations: 30,
        workspaceRoot: this.sandboxRoot,
        orchestraContext: {
          mailbox: this.mailbox,
          agentId: instance.id,
          peers: workOrders.map(w => w.assignedTo).filter(Boolean) as string[],
          workOrderId: 'security-review'
        }
      });

      const duration = Date.now() - startTime;
      const cost = provider.estimateCost(result.inputTokensEstimate, result.outputTokensEstimate, instance.modelId);

      // Parse the agent's JSON output
      let parsed: any = { approved: true, issues: [], summary: result.finalText };
      try {
        const cleaned = result.finalText.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/, '').trim();
        // Find the last JSON object in the text (in case agent wrote prose first)
        const lastBrace = cleaned.lastIndexOf('}');
        const firstBrace = cleaned.indexOf('{');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
          parsed = JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
        }
      } catch { /* fall through with defaults */ }

      return {
        agentId: instance.id,
        approved: !!parsed.approved,
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        summary: String(parsed.summary ?? result.finalText.substring(0, 500)),
        duration,
        cost
      };
    } finally {
      instance.release();
    }
  }

  private async synthesize(
    request: string,
    workOrders: WorkOrder[],
    securityReview: SecurityReviewResult | undefined,
    available: AICodingProvider[]
  ): Promise<string> {
    const architect = this.router.selectProvider('architect', available);
    if (!architect) {
      return this.fallbackSynthesis(workOrders, securityReview);
    }

    const woSummary = workOrders.map(w =>
      `## ${w.id} — ${w.title} (${w.role}, ${w.assignedTo}) — ${w.status}\n` +
      `Files: created [${w.result?.filesCreated.join(', ') || 'none'}], modified [${w.result?.filesModified.join(', ') || 'none'}]\n` +
      `Tools: ${w.result?.toolsUsed.join(', ') || 'none'}\n` +
      `Iterations: ${w.result?.iterations ?? 0}\n` +
      `Output: ${w.result?.finalText.substring(0, 1500) ?? '(no output)'}`
    ).join('\n\n---\n\n');

    const securitySection = securityReview
      ? `\n\n## Security Review (by ${securityReview.agentId})\n` +
        `Approved: ${securityReview.approved ? 'YES' : 'NO'}\n` +
        `Issues found: ${securityReview.issues.length}\n` +
        `Summary: ${securityReview.summary}\n` +
        (securityReview.issues.length > 0
          ? `\nIssues:\n${securityReview.issues.map(i => `- [${i.severity}] ${i.category}: ${i.description} (${i.fileRef ?? 'no file'}) → ${i.recommendation}`).join('\n')}`
          : '')
      : '';

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'Produce a final orchestration report in clear markdown. Cover: what each agent did, files changed, security findings, and any failures or open issues.'
      },
      {
        role: 'user',
        content: `Original request: ${request}\n\n${woSummary}${securitySection}`
      }
    ];

    let output = '';
    const stream = architect.chat({ model: architect.models[0].id, messages, stream: true, maxTokens: 4000 });
    for await (const chunk of stream) {
      if (chunk.content) output += chunk.content;
      if (chunk.done) break;
    }
    return output || this.fallbackSynthesis(workOrders, securityReview);
  }

  private fallbackSynthesis(workOrders: WorkOrder[], securityReview?: SecurityReviewResult): string {
    const parts = workOrders.map(w =>
      `### ${w.id}: ${w.title} — ${w.status}\n` +
      `Agent: ${w.assignedTo}\n` +
      `${w.result?.summary ?? ''}`
    );
    if (securityReview) {
      parts.push(`### Security Review — ${securityReview.approved ? 'APPROVED' : 'BLOCKED'}\n${securityReview.summary}`);
    }
    return parts.join('\n\n');
  }

  private collectFilesTouched(workOrders: WorkOrder[]): string[] {
    const files = new Set<string>();
    for (const w of workOrders) {
      for (const f of w.result?.filesCreated ?? []) files.add(f);
      for (const f of w.result?.filesModified ?? []) files.add(f);
    }
    return [...files];
  }

  private emit(e: DirectorEvent): void {
    this.onEvent?.(e);
  }
}
