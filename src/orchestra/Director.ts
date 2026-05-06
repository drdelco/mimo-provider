/**
 * CodingDirector - Multi-agent orchestration system
 * Coordinates multiple AI providers for complex coding tasks
 */

import * as vscode from 'vscode';
import { AICodingProvider, ChatMessage, ChatChunk, ToolDefinition } from '../providers/BaseProvider';
import { ProviderFactory } from '../providers/BaseProvider';
import { MiMoProvider } from '../providers/MiMoProvider';
import { KimiProvider } from '../providers/KimiProvider';
import { DeepSeekProvider } from '../providers/DeepSeekProvider';
import { ClaudeProvider } from '../providers/ClaudeProvider';

export interface Subtask {
  id: string;
  description: string;
  agent: string; // which provider/agent should handle this
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
  success: boolean;
  output: string;
  tokensUsed: number;
  cost: number;
  duration: number;
}

export interface OrchestrationResult {
  success: boolean;
  plan: ExecutionPlan;
  results: SubtaskResult[];
  finalOutput: string;
  totalCost: number;
  totalTokens: number;
  totalDuration: number;
}

/**
 * Task router - decides which agent is best for each task
 */
export class TaskRouter {
  private agentRoles: Map<string, string[]> = new Map([
    ['architect', ['kimi', 'claude']],
    ['coder', ['mimo', 'deepseek']],
    ['reviewer', ['claude', 'kimi']],
    ['optimizer', ['deepseek', 'mimo']],
    ['debugger', ['mimo', 'claude']],
    ['tester', ['mimo', 'deepseek']]
  ]);

  selectAgent(subtask: Subtask, availableProviders: AICodingProvider[]): AICodingProvider | undefined {
    const preferred = this.agentRoles.get(subtask.agent) || [];
    
    for (const providerName of preferred) {
      const provider = availableProviders.find(p => p.name === providerName);
      if (provider) return provider;
    }
    
    // Fallback to first available
    return availableProviders[0];
  }

  getAgentDescription(role: string): string {
    const descriptions: Record<string, string> = {
      architect: 'System design and architecture planning',
      coder: 'Code generation and implementation',
      reviewer: 'Code review and security analysis',
      optimizer: 'Performance optimization and refactoring',
      debugger: 'Debugging and error resolution',
      tester: 'Test generation and validation'
    };
    return descriptions[role] || 'General coding assistant';
  }
}

/**
 * Shared memory for context persistence across agents
 */
export class SharedMemory {
  private contextDir: string;
  private vectorStore: Map<string, string> = new Map();

  constructor(workspaceRoot: string) {
    this.contextDir = workspaceRoot;
  }

  async add(key: string, content: string): Promise<void> {
    this.vectorStore.set(key, content);
    
    // Persist to .orchestra-context.md
    const contextFile = `${this.contextDir}/.orchestra-context.md`;
    const fs = require('fs');
    const entry = `\n## ${key}\n${content}\n`;
    
    try {
      if (fs.existsSync(contextFile)) {
        fs.appendFileSync(contextFile, entry);
      } else {
        fs.writeFileSync(contextFile, `# Orchestra Context\n${entry}`);
      }
    } catch (e) {
      // Silent fail for persistence
    }
  }

  async get(key: string): Promise<string | undefined> {
    return this.vectorStore.get(key);
  }

  async search(query: string): Promise<string[]> {
    // Simple keyword search - in production would use embeddings
    const results: string[] = [];
    for (const [key, content] of this.vectorStore) {
      if (content.toLowerCase().includes(query.toLowerCase())) {
        results.push(content);
      }
    }
    return results;
  }

  async getProjectContext(): Promise<string> {
    const fs = require('fs');
    const files = [
      'CLAUDE.md',
      '.cursorrules',
      '.mimo-context.md',
      '.orchestra-context.md'
    ];
    
    let context = '';
    for (const file of files) {
      try {
        const path = `${this.contextDir}/${file}`;
        if (fs.existsSync(path)) {
          context += `\n--- ${file} ---\n${fs.readFileSync(path, 'utf-8')}\n`;
        }
      } catch {
        // Skip missing files
      }
    }
    return context;
  }
}

/**
 * Main director that orchestrates the entire workflow
 */
export class CodingDirector {
  private factory: ProviderFactory;
  private router: TaskRouter;
  private memory: SharedMemory;
  private budgetLimit: number;
  private usedBudget: number = 0;

  constructor(workspaceRoot: string, budgetLimit: number = 5.0) {
    this.factory = new ProviderFactory();
    this.router = new TaskRouter();
    this.memory = new SharedMemory(workspaceRoot);
    this.budgetLimit = budgetLimit;
    
    // Register all providers
    this.factory.register(new MiMoProvider());
    this.factory.register(new KimiProvider());
    this.factory.register(new DeepSeekProvider());
    this.factory.register(new ClaudeProvider());
  }

  /**
   * Main entry point - execute a complex coding request
   */
  async execute(request: string, progress?: vscode.Progress<{ message?: string; increment?: number }>): Promise<OrchestrationResult> {
    const startTime = Date.now();
    
    // Get available providers
    const available = await this.factory.getAvailable();
    if (available.length === 0) {
      throw new Error('No AI providers available. Please configure at least one API key.');
    }

    // Phase 1: Planning (Architect)
    progress?.report({ message: '🏗️ Architect analyzing request...', increment: 10 });
    const plan = await this.createPlan(request, available);

    // Phase 2: Execution
    progress?.report({ message: `📋 Plan created: ${plan.subtasks.length} subtasks`, increment: 10 });
    const results: SubtaskResult[] = [];

    for (let i = 0; i < plan.subtasks.length; i++) {
      const subtask = plan.subtasks[i];
      const percent = Math.round(((i + 1) / plan.subtasks.length) * 60) + 20;
      progress?.report({ 
        message: `⚡ Executing: ${subtask.description} (${i + 1}/${plan.subtasks.length})`, 
        increment: percent 
      });

      const result = await this.executeSubtask(subtask, available, plan);
      results.push(result);

      // Budget check
      this.usedBudget += result.cost;
      if (this.usedBudget > this.budgetLimit) {
        throw new Error(`Budget exceeded: $${this.usedBudget.toFixed(2)} / $${this.budgetLimit}`);
      }

      // Store result in memory
      await this.memory.add(`subtask-${subtask.id}`, result.output);
    }

    // Phase 3: Synthesis
    progress?.report({ message: '🔄 Synthesizing final result...', increment: 90 });
    const finalOutput = await this.synthesizeResults(plan, results, available);

    const totalDuration = Date.now() - startTime;
    const totalCost = results.reduce((sum, r) => sum + r.cost, 0);
    const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);

    return {
      success: results.every(r => r.success),
      plan,
      results,
      finalOutput,
      totalCost,
      totalTokens,
      totalDuration
    };
  }

  /**
   * Create execution plan using the architect agent
   */
  private async createPlan(request: string, providers: AICodingProvider[]): Promise<ExecutionPlan> {
    const architect = this.router.selectAgent({ id: 'plan', description: 'plan', agent: 'architect', expectedOutput: '' }, providers);
    if (!architect) throw new Error('No architect agent available');

    const context = await this.memory.getProjectContext();
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a system architect. Analyze coding requests and break them into specific subtasks.
        For each subtask, specify:
        - agent: one of [coder, reviewer, optimizer, debugger, tester]
        - description: what to do
        - expectedOutput: what the agent should produce
        
        Respond in JSON format:
        {
          "subtasks": [
            { "id": "1", "description": "...", "agent": "coder", "expectedOutput": "..." }
          ],
          "requirements": ["requirement1", "requirement2"]
        }`
      },
      {
        role: 'user',
        content: `Project context:\n${context}\n\nRequest: ${request}`
      }
    ];

    let response = '';
    const stream = architect.chat({ model: architect.models[0].id, messages, stream: true });
    for await (const chunk of stream) {
      response += chunk.content;
    }

    try {
      const parsed = JSON.parse(response);
      return {
        originalRequest: request,
        subtasks: parsed.subtasks.map((st: any, idx: number) => ({
          id: st.id || `${idx + 1}`,
          description: st.description,
          agent: st.agent,
          expectedOutput: st.expectedOutput,
          dependsOn: st.dependsOn
        })),
        requirements: parsed.requirements || []
      };
    } catch {
      // Fallback: single task
      return {
        originalRequest: request,
        subtasks: [{
          id: '1',
          description: request,
          agent: 'coder',
          expectedOutput: 'Complete implementation'
        }],
        requirements: []
      };
    }
  }

  /**
   * Execute a single subtask
   */
  private async executeSubtask(
    subtask: Subtask, 
    providers: AICodingProvider[],
    plan: ExecutionPlan
  ): Promise<SubtaskResult> {
    const startTime = Date.now();
    const agent = this.router.selectAgent(subtask, providers);
    if (!agent) {
      return {
        subtaskId: subtask.id,
        success: false,
        output: `No agent available for role: ${subtask.agent}`,
        tokensUsed: 0,
        cost: 0,
        duration: 0
      };
    }

    const context = await this.memory.getProjectContext();
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a ${this.router.getAgentDescription(subtask.agent)}.
        Task: ${subtask.description}
        Expected output: ${subtask.expectedOutput}
        Requirements: ${plan.requirements.join(', ')}`
      },
      {
        role: 'user',
        content: `Project context:\n${context}\n\nExecute this task: ${subtask.description}`
      }
    ];

    let output = '';
    let tokenCount = 0;
    
    try {
      const stream = agent.chat({ 
        model: agent.models[0].id, 
        messages, 
        stream: true,
        maxTokens: 4000
      });

      for await (const chunk of stream) {
        output += chunk.content;
        tokenCount += agent.countTokens(chunk.content);
      }

      const duration = Date.now() - startTime;
      const cost = agent.estimateCost(tokenCount, tokenCount, agent.models[0].id);

      return {
        subtaskId: subtask.id,
        success: true,
        output,
        tokensUsed: tokenCount,
        cost,
        duration
      };
    } catch (error: any) {
      return {
        subtaskId: subtask.id,
        success: false,
        output: `Error: ${error.message}`,
        tokensUsed: tokenCount,
        cost: 0,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Synthesize all subtask results into final output
   */
  private async synthesizeResults(
    plan: ExecutionPlan,
    results: SubtaskResult[],
    providers: AICodingProvider[]
  ): Promise<string> {
    const architect = this.router.selectAgent({ id: 'synth', description: 'synth', agent: 'architect', expectedOutput: '' }, providers);
    if (!architect) {
      return results.map(r => r.output).join('\n\n---\n\n');
    }

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are a system architect. Synthesize multiple subtask outputs into a coherent final result. Combine code, remove duplicates, and ensure consistency.'
      },
      {
        role: 'user',
        content: `Original request: ${plan.originalRequest}\n\nSubtask results:\n${results.map(r => `## ${r.subtaskId}\n${r.output}`).join('\n\n')}`
      }
    ];

    let output = '';
    const stream = architect.chat({ model: architect.models[0].id, messages, stream: true });
    for await (const chunk of stream) {
      output += chunk.content;
    }

    return output;
  }

  getUsedBudget(): number {
    return this.usedBudget;
  }

  getBudgetLimit(): number {
    return this.budgetLimit;
  }
}
