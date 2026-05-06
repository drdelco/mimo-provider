/**
 * CodingDirector - Multi-agent orchestration system.
 *
 * Flow:
 *   1. PLAN     — architect agent breaks request into subtasks (with deps + agent role)
 *   2. EXECUTE  — DAG executor runs subtasks in parallel respecting dependencies
 *                 Each subtask acquires an AgentInstance from the pool and runs
 *                 a full tool-calling loop via AgentExecutor (real file I/O).
 *   3. REVIEW   — security reviewer checks final output (Sprint 3, stub for now)
 *   4. SYNTHESIZE — architect combines all subtask outputs into final result
 */

import * as vscode from 'vscode';
import { AICodingProvider, ChatMessage } from '../providers/BaseProvider';
import { ProviderFactory } from '../providers/BaseProvider';
import { MiMoProvider } from '../providers/MiMoProvider';
import { KimiProvider } from '../providers/KimiProvider';
import { DeepSeekProvider } from '../providers/DeepSeekProvider';
import { ClaudeProvider } from '../providers/ClaudeProvider';
import { AgentExecutor, AgentEvent } from './AgentExecutor';
import { AgentPool } from './AgentPool';

export type AgentRole = 'architect' | 'coder' | 'reviewer' | 'optimizer' | 'debugger' | 'tester' | 'security';

export interface Subtask {
  id: string;
  description: string;
  agent: AgentRole;
  dependsOn?: string[];
  expectedOutput: string;
}

export interface ExecutionPlan {
  originalRequest: string;
  subtasks: Subtask[];
  requirements: string[];
}

export interface SubtaskResult {
  subtaskId: string;
  agentId: string;        // e.g. "kimi-coder-001"
  role: string;
  success: boolean;
  output: string;
  toolsUsed: string[];
  filesRead: string[];
  filesModified: string[];
  iterations: number;
  tokensUsed: number;
  cost: number;
  duration: number;
  error?: string;
}

export interface OrchestrationResult {
  success: boolean;
  plan: ExecutionPlan;
  results: SubtaskResult[];
  finalOutput: string;
  totalCost: number;
  totalTokens: number;
  totalDuration: number;
  poolUsage: Record<string, { inUse: number; limit: number; waiting: number }>;
}

export type DirectorEvent =
  | { type: 'plan-start'; request: string }
  | { type: 'plan-done'; subtaskCount: number }
  | { type: 'subtask-start'; subtaskId: string; agentId: string; role: string; description: string }
  | { type: 'subtask-progress'; subtaskId: string; agentId: string; event: AgentEvent }
  | { type: 'subtask-done'; subtaskId: string; agentId: string; success: boolean; duration: number; cost: number }
  | { type: 'synthesize-start' }
  | { type: 'synthesize-done' }
  | { type: 'budget-warning'; used: number; limit: number };

/** Maps semantic role to preferred provider order (first available wins) */
export class TaskRouter {
  private agentRoles: Map<AgentRole, string[]> = new Map([
    ['architect', ['kimi', 'claude', 'mimo']],
    ['coder',     ['mimo', 'deepseek', 'kimi']],
    ['reviewer',  ['claude', 'kimi', 'mimo']],
    ['security',  ['claude', 'kimi', 'mimo']],
    ['optimizer', ['deepseek', 'mimo', 'kimi']],
    ['debugger',  ['mimo', 'claude', 'deepseek']],
    ['tester',    ['mimo', 'deepseek', 'kimi']]
  ]);

  selectProvider(role: AgentRole, available: AICodingProvider[]): AICodingProvider | undefined {
    const preferred = this.agentRoles.get(role) ?? [];
    for (const name of preferred) {
      const p = available.find(x => x.name === name);
      if (p) return p;
    }
    return available[0];
  }

  describe(role: AgentRole): string {
    const map: Record<AgentRole, string> = {
      architect: 'a system architect — design and break down complex tasks',
      coder:     'a coder — implement code according to spec, using read_file/write_file/edit_file/run_terminal',
      reviewer:  'a code reviewer — analyze quality, correctness, and maintainability',
      security:  'a security auditor — find vulnerabilities (OWASP Top 10), unsafe patterns, secrets exposure',
      optimizer: 'a performance optimizer — identify and fix bottlenecks',
      debugger:  'a debugger — diagnose and fix bugs',
      tester:    'a test author — write and run tests using run_terminal'
    };
    return map[role];
  }
}

/** Keyed key→content store, persisted to .orchestra-context.md */
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

/** Main orchestrator */
export class CodingDirector {
  private factory: ProviderFactory;
  private router: TaskRouter;
  private memory: SharedMemory;
  private executor: AgentExecutor;
  private pool: AgentPool;
  private budgetLimit: number;
  private usedBudget = 0;
  private onEvent?: (e: DirectorEvent) => void;

  constructor(workspaceRoot: string, budgetLimit: number = 5.0, pool?: AgentPool) {
    this.factory = new ProviderFactory();
    this.router = new TaskRouter();
    this.memory = new SharedMemory(workspaceRoot);
    this.executor = new AgentExecutor();
    this.pool = pool ?? new AgentPool();
    this.budgetLimit = budgetLimit;

    this.factory.register(new MiMoProvider());
    this.factory.register(new KimiProvider());
    this.factory.register(new DeepSeekProvider());
    this.factory.register(new ClaudeProvider());
  }

  setEventListener(handler: (e: DirectorEvent) => void): void {
    this.onEvent = handler;
  }

  getPoolUsage() { return this.pool.getAllUsage(); }
  getUsedBudget(): number { return this.usedBudget; }
  getBudgetLimit(): number { return this.budgetLimit; }

  /** Main entry point */
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
    progress?.report({ message: 'Architect analyzing request...', increment: 5 });
    this.emit({ type: 'plan-start', request });
    const plan = await this.createPlan(request, available);
    this.emit({ type: 'plan-done', subtaskCount: plan.subtasks.length });
    progress?.report({ message: `Plan: ${plan.subtasks.length} subtasks`, increment: 5 });

    // ---- Phase 2: EXECUTE (DAG with parallel batches) ----
    const results = await this.executeDag(plan, available, progress);

    // ---- Phase 3: SYNTHESIZE ----
    this.emit({ type: 'synthesize-start' });
    progress?.report({ message: 'Synthesizing final result...', increment: 90 });
    const finalOutput = await this.synthesizeResults(plan, results, available);
    this.emit({ type: 'synthesize-done' });

    return {
      success: results.every(r => r.success),
      plan,
      results,
      finalOutput,
      totalCost: results.reduce((s, r) => s + r.cost, 0),
      totalTokens: results.reduce((s, r) => s + r.tokensUsed, 0),
      totalDuration: Date.now() - startTime,
      poolUsage: this.pool.getAllUsage()
    };
  }

  /** Build the plan via the architect */
  private async createPlan(request: string, available: AICodingProvider[]): Promise<ExecutionPlan> {
    const architect = this.router.selectProvider('architect', available);
    if (!architect) throw new Error('No architect provider available');

    const context = this.memory.loadProjectContext();
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a system architect. Break the user's request into specific subtasks for parallel execution by specialist agents.

Available agent roles:
- coder: implementation (read/write/edit files, run commands)
- reviewer: code quality review
- security: security audit (OWASP, secrets, injection risks)
- optimizer: performance improvements
- debugger: bug diagnosis and fixes
- tester: write and execute tests

Respond ONLY with valid JSON, no markdown fences:
{
  "subtasks": [
    {
      "id": "1",
      "description": "Concrete task description with specific files/functions",
      "agent": "coder",
      "dependsOn": [],
      "expectedOutput": "What this task should produce"
    }
  ],
  "requirements": ["constraint1", "constraint2"]
}

Use dependsOn: [] for independent subtasks (will run in parallel).
Reference subtask IDs in dependsOn for tasks that need previous outputs.
Aim for 2-6 subtasks. Avoid over-decomposition for simple requests.`
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
      // Strip markdown fences if architect ignored instructions
      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        originalRequest: request,
        subtasks: parsed.subtasks.map((st: any, idx: number) => ({
          id: String(st.id ?? idx + 1),
          description: st.description,
          agent: st.agent as AgentRole,
          dependsOn: Array.isArray(st.dependsOn) ? st.dependsOn.map(String) : [],
          expectedOutput: st.expectedOutput || ''
        })),
        requirements: Array.isArray(parsed.requirements) ? parsed.requirements : []
      };
    } catch {
      // Fallback: single coder task
      return {
        originalRequest: request,
        subtasks: [{
          id: '1',
          description: request,
          agent: 'coder',
          dependsOn: [],
          expectedOutput: 'Working implementation'
        }],
        requirements: []
      };
    }
  }

  /**
   * Execute subtasks respecting the dependency DAG.
   * Independent subtasks run in parallel (limited by pool concurrency).
   */
  private async executeDag(
    plan: ExecutionPlan,
    available: AICodingProvider[],
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<SubtaskResult[]> {
    const results = new Map<string, SubtaskResult>();
    const completed = new Set<string>();
    const remaining = new Map(plan.subtasks.map(st => [st.id, st]));
    let completedCount = 0;
    const total = plan.subtasks.length;

    while (remaining.size > 0) {
      // Find subtasks whose dependencies are all done
      const ready = [...remaining.values()].filter(st =>
        (st.dependsOn ?? []).every(dep => completed.has(dep))
      );

      if (ready.length === 0) {
        // Cycle or impossible deps — bail out
        for (const st of remaining.values()) {
          results.set(st.id, this.failureResult(st, 'Unsatisfiable dependency'));
          completed.add(st.id);
        }
        break;
      }

      // Run all ready subtasks in parallel
      progress?.report({
        message: `Running ${ready.length} subtask(s) in parallel: ${ready.map(s => s.agent).join(', ')}`,
        increment: 0
      });

      const batchResults = await Promise.all(
        ready.map(st => this.runSubtask(st, plan, available, results))
      );

      for (const r of batchResults) {
        results.set(r.subtaskId, r);
        completed.add(r.subtaskId);
        remaining.delete(r.subtaskId);
        completedCount++;

        this.usedBudget += r.cost;
        if (this.usedBudget > this.budgetLimit) {
          this.emit({ type: 'budget-warning', used: this.usedBudget, limit: this.budgetLimit });
          throw new Error(`Budget exceeded: $${this.usedBudget.toFixed(2)} / $${this.budgetLimit}`);
        }

        // Save to shared memory for downstream tasks
        this.memory.add(`subtask-${r.subtaskId}`, r.output);

        const pct = Math.round((completedCount / total) * 70) + 10;
        progress?.report({ message: `${completedCount}/${total} subtasks complete`, increment: pct });
      }
    }

    return plan.subtasks.map(st => results.get(st.id)!);
  }

  /** Run a single subtask: acquire agent, execute with tools, release */
  private async runSubtask(
    subtask: Subtask,
    plan: ExecutionPlan,
    available: AICodingProvider[],
    priorResults: Map<string, SubtaskResult>
  ): Promise<SubtaskResult> {
    const startTime = Date.now();
    const provider = this.router.selectProvider(subtask.agent, available);
    if (!provider) {
      return this.failureResult(subtask, `No provider available for role: ${subtask.agent}`);
    }

    const instance = await this.pool.acquire(provider, provider.models[0].id, subtask.agent);
    this.emit({
      type: 'subtask-start',
      subtaskId: subtask.id,
      agentId: instance.id,
      role: subtask.agent,
      description: subtask.description
    });

    try {
      // Build context: project files + outputs from dependencies
      const projectContext = this.memory.loadProjectContext();
      const depContext = (subtask.dependsOn ?? [])
        .map(depId => priorResults.get(depId))
        .filter(r => r && r.success)
        .map(r => `\n--- Output from subtask ${r!.subtaskId} (${r!.role}) ---\n${r!.output}\n`)
        .join('\n');

      const systemPrompt = `You are ${this.router.describe(subtask.agent)}.

Working as agent: ${instance.id}
Original user request: ${plan.originalRequest}
Requirements: ${plan.requirements.join('; ') || 'none specified'}

Your specific subtask: ${subtask.description}
Expected output: ${subtask.expectedOutput}

You have access to file and shell tools. Use them to actually inspect and modify the codebase.
When done, give a concise summary of what you produced.

PROJECT CONTEXT:
${projectContext}
${depContext ? '\nDEPENDENCY OUTPUTS:\n' + depContext : ''}`;

      const result = await this.executor.run({
        provider,
        modelId: instance.modelId,
        systemPrompt,
        userTask: subtask.description,
        maxIterations: 30,
        onProgress: (event) => {
          this.emit({ type: 'subtask-progress', subtaskId: subtask.id, agentId: instance.id, event });
        }
      });

      const duration = Date.now() - startTime;
      const tokens = result.inputTokensEstimate + result.outputTokensEstimate;
      const cost = provider.estimateCost(result.inputTokensEstimate, result.outputTokensEstimate, instance.modelId);

      this.emit({
        type: 'subtask-done',
        subtaskId: subtask.id,
        agentId: instance.id,
        success: result.success,
        duration,
        cost
      });

      return {
        subtaskId: subtask.id,
        agentId: instance.id,
        role: subtask.agent,
        success: result.success,
        output: result.finalText || result.error || '',
        toolsUsed: result.toolsUsed,
        filesRead: result.filesRead,
        filesModified: result.filesModified,
        iterations: result.iterations,
        tokensUsed: tokens,
        cost,
        duration,
        error: result.error
      };
    } finally {
      instance.release();
    }
  }

  private async synthesizeResults(
    plan: ExecutionPlan,
    results: SubtaskResult[],
    available: AICodingProvider[]
  ): Promise<string> {
    const architect = this.router.selectProvider('architect', available);
    if (!architect) {
      return results.map(r => `### ${r.role} (${r.agentId})\n${r.output}`).join('\n\n---\n\n');
    }

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'Synthesize the multi-agent execution into a coherent final report. Highlight what was done, files changed, and any issues found by reviewers.'
      },
      {
        role: 'user',
        content: `Original request: ${plan.originalRequest}\n\nAgent outputs:\n${results.map(r =>
          `## ${r.role} agent (${r.agentId}) — ${r.success ? 'SUCCESS' : 'FAILED'}\n` +
          `Iterations: ${r.iterations}, Files modified: ${r.filesModified.join(', ') || 'none'}\n\n${r.output}`
        ).join('\n\n---\n\n')}`
      }
    ];

    let output = '';
    const stream = architect.chat({ model: architect.models[0].id, messages, stream: true, maxTokens: 4000 });
    for await (const chunk of stream) {
      if (chunk.content) output += chunk.content;
      if (chunk.done) break;
    }
    return output;
  }

  private emit(e: DirectorEvent): void {
    this.onEvent?.(e);
  }

  private failureResult(subtask: Subtask, reason: string): SubtaskResult {
    return {
      subtaskId: subtask.id,
      agentId: 'none',
      role: subtask.agent,
      success: false,
      output: reason,
      toolsUsed: [],
      filesRead: [],
      filesModified: [],
      iterations: 0,
      tokensUsed: 0,
      cost: 0,
      duration: 0,
      error: reason
    };
  }
}
