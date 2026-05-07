/**
 * AgentExecutor - Runs an AI agent with tool-calling capability.
 *
 * Wraps a provider in a tool-execution loop: the agent generates tool calls,
 * we execute them via tools.ts, feed results back, repeat until the agent
 * produces a final text response (no more tool_calls).
 *
 * This is what makes an "agent" different from a "chat completion": the
 * ability to actually read/write files and run commands as part of solving
 * the task, not just generate text describing what to do.
 */

import { AICodingProvider, ChatMessage, ChatChunk, ToolCall } from '../providers/BaseProvider';
import { TOOLS, executeTool, setWorkspaceRootOverride } from '../tools';
import {
  ORCHESTRA_TOOLS,
  OrchestraToolContext,
  setOrchestraContext,
  isOrchestraTool,
  executeOrchestraTool
} from './OrchestraTools';

export interface AgentExecutionOptions {
  provider: AICodingProvider;
  modelId: string;
  systemPrompt: string;
  userTask: string;
  maxIterations?: number;
  onProgress?: (event: AgentEvent) => void;
  /** Orchestra context — if provided, ask_agent / notify / broadcast / check_inbox become available */
  orchestraContext?: OrchestraToolContext;
  /**
   * Sandbox directory the agent's filesystem tools will resolve relative paths against.
   * If unset, agents write into the active VS Code workspace (same as single-agent chat).
   */
  workspaceRoot?: string;
}

export type AgentEvent =
  | { type: 'thinking'; iteration: number }
  | { type: 'text'; content: string }
  | { type: 'tool-call'; name: string; args: any }
  | { type: 'tool-result'; name: string; result: string; truncated: boolean }
  | { type: 'done'; finalText: string; iterations: number };

export interface AgentExecutionResult {
  success: boolean;
  finalText: string;
  iterations: number;
  toolsUsed: string[];
  filesRead: string[];
  filesModified: string[];
  inputTokensEstimate: number;
  outputTokensEstimate: number;
  error?: string;
}

export class AgentExecutor {
  /**
   * Run the agent with tool calling until it produces a final answer or hits max iterations.
   */
  async run(opts: AgentExecutionOptions): Promise<AgentExecutionResult> {
    const maxIterations = opts.maxIterations ?? 50;
    const messages: ChatMessage[] = [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user', content: opts.userTask }
    ];

    const toolsUsed: string[] = [];
    const filesRead = new Set<string>();
    const filesModified = new Set<string>();
    let inputTokensEstimate = opts.provider.countTokens(opts.systemPrompt + opts.userTask);
    let outputTokensEstimate = 0;
    let finalText = '';
    let iteration = 0;

    try {
      while (iteration < maxIterations) {
        iteration++;
        opts.onProgress?.({ type: 'thinking', iteration });

        // Collect this turn's response
        let turnContent = '';
        const turnToolCalls = new Map<number, ToolCall>();

        const availableTools = opts.orchestraContext ? [...TOOLS, ...ORCHESTRA_TOOLS] : TOOLS;
        const stream = opts.provider.chat({
          model: opts.modelId,
          messages,
          stream: true,
          tools: availableTools,
          maxTokens: 8192
        });

        for await (const chunk of stream) {
          if (chunk.content) {
            turnContent += chunk.content;
            opts.onProgress?.({ type: 'text', content: chunk.content });
          }
          if (chunk.toolCalls) {
            for (const tc of chunk.toolCalls) {
              // Streaming deltas: only the FIRST chunk for a given call carries id+name.
              // Subsequent chunks carry only `index` and a fragment of `arguments`.
              // We must group by index (canonical), with id as a fallback.
              const key = typeof tc.index === 'number' ? tc.index : (tc.id ? `id:${tc.id}` : turnToolCalls.size);
              const existing = turnToolCalls.get(key as number);
              if (existing) {
                if (tc.id && !existing.id) existing.id = tc.id;
                if (tc.function.name) existing.function.name += tc.function.name;
                if (tc.function.arguments) existing.function.arguments += tc.function.arguments;
              } else {
                turnToolCalls.set(key as number, {
                  id: tc.id || '',
                  function: {
                    name: tc.function.name || '',
                    arguments: tc.function.arguments || ''
                  }
                });
              }
            }
          }
          if (chunk.done) break;
        }

        outputTokensEstimate += opts.provider.countTokens(turnContent);

        // No tool calls → agent is done
        if (turnToolCalls.size === 0) {
          finalText = turnContent;
          opts.onProgress?.({ type: 'done', finalText, iterations: iteration });
          return {
            success: true,
            finalText,
            iterations: iteration,
            toolsUsed,
            filesRead: [...filesRead],
            filesModified: [...filesModified],
            inputTokensEstimate,
            outputTokensEstimate
          };
        }

        // Add assistant message with tool_calls to history
        const callsArray = [...turnToolCalls.values()];
        // DeepSeek strictly requires `type: "function"` on each tool_call.
        // Other providers tolerate its absence, but adding it is OpenAI-spec-correct.
        const callsForApi = callsArray.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: tc.function
        }));
        messages.push({
          role: 'assistant',
          content: turnContent,
          tool_calls: callsForApi
        });

        // Execute each tool call and feed result back
        for (const tc of callsArray) {
          let args: any = {};
          try { args = JSON.parse(tc.function.arguments); } catch { /* malformed args */ }

          opts.onProgress?.({ type: 'tool-call', name: tc.function.name, args });

          toolsUsed.push(tc.function.name);
          if (tc.function.name === 'read_file' && args.path) filesRead.add(args.path);
          if ((tc.function.name === 'write_file' || tc.function.name === 'edit_file') && args.path) {
            filesModified.add(args.path);
          }

          let result = '';
          try {
            if (isOrchestraTool(tc.function.name)) {
              setOrchestraContext(opts.orchestraContext);
              try {
                result = await executeOrchestraTool(tc);
              } finally {
                setOrchestraContext(undefined);
              }
            } else {
              // Sandbox the agent's filesystem operations to opts.workspaceRoot if set
              if (opts.workspaceRoot) setWorkspaceRootOverride(opts.workspaceRoot);
              try {
                result = await executeTool(tc);
              } finally {
                if (opts.workspaceRoot) setWorkspaceRootOverride(undefined);
              }
            }
          } catch (err: any) {
            result = `Tool error: ${err.message}`;
          }

          const truncated = result.length > 4000;
          const historyResult = truncated ? result.substring(0, 4000) + '\n... (truncated)' : result;

          opts.onProgress?.({
            type: 'tool-result',
            name: tc.function.name,
            result: result.length > 1000 ? result.substring(0, 1000) + '\n...' : result,
            truncated
          });

          messages.push({
            role: 'tool',
            content: historyResult,
            tool_call_id: tc.id
          });

          inputTokensEstimate += opts.provider.countTokens(historyResult);
        }
      }

      // Hit max iterations without final response
      return {
        success: false,
        finalText,
        iterations: iteration,
        toolsUsed,
        filesRead: [...filesRead],
        filesModified: [...filesModified],
        inputTokensEstimate,
        outputTokensEstimate,
        error: `Max iterations (${maxIterations}) reached without final response`
      };
    } catch (err: any) {
      return {
        success: false,
        finalText,
        iterations: iteration,
        toolsUsed,
        filesRead: [...filesRead],
        filesModified: [...filesModified],
        inputTokensEstimate,
        outputTokensEstimate,
        error: err.message
      };
    }
  }
}
