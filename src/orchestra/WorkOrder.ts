/**
 * WorkOrder — the formal contract for a unit of work in the Orchestra.
 *
 * This is the runtime artifact that gets handed to an agent. It is NOT just
 * a description: it carries acceptance criteria, expected deliverables, and
 * inputs. The agent knows when it is done by checking against the criteria.
 *
 * Difference vs the old `Subtask`:
 *   - acceptanceCriteria: explicit checks the agent must satisfy
 *   - deliverables: concrete outputs (file paths, function names) the
 *     agent commits to producing
 *   - inputs: typed references to context the agent needs (files, prior
 *     WO outputs)
 *   - status: tracked through its lifecycle so the Director can react
 *   - blockers: when an agent gets stuck, it records WHY here so the
 *     Mailbox/Director can resolve it
 *
 * The architect emits WorkOrders during planning. The Director schedules
 * them via the DAG executor. Each agent receives a fully-specified
 * WorkOrder and either delivers, blocks, or fails.
 */

import { AgentRole } from './Director';

export type WorkOrderStatus =
  | 'pending'         // Created, not yet started
  | 'in-progress'     // Agent is actively working on it
  | 'awaiting-review' // Agent finished, reviewer hasn't approved yet
  | 'blocked'         // Agent hit a blocker (waiting on info, missing dep)
  | 'done'            // Reviewer approved, complete
  | 'failed';         // Agent or review failed unrecoverably

export interface WorkOrderInput {
  /** "file" = read this file; "workorder" = include this WO's output as context; "context" = freeform string */
  type: 'file' | 'workorder' | 'context';
  ref: string;
  /** Optional human-readable label */
  label?: string;
}

export interface WorkOrderResult {
  /** Files the agent created (relative paths) */
  filesCreated: string[];
  /** Files the agent modified (relative paths) */
  filesModified: string[];
  /** Tools used during execution */
  toolsUsed: string[];
  /** Brief summary of what was produced */
  summary: string;
  /** If status='blocked', what is blocking it */
  blockers?: string[];
  /** Iterations used */
  iterations: number;
  /** Tokens consumed */
  tokensUsed: number;
  /** Cost in USD */
  cost: number;
  /** Wall-clock duration in ms */
  duration: number;
  /** Final agent text response */
  finalText: string;
  /** Error message if status='failed' */
  error?: string;
}

export interface WorkOrder {
  /** Unique ID like "WO-001" */
  id: string;
  /** Short title, used in UI and logs */
  title: string;
  /** Detailed description of what to do */
  description: string;
  /** Which agent role should execute this */
  role: AgentRole;
  /** Other WO IDs that must be done before this one starts */
  dependsOn: string[];
  /** Required inputs (files, prior WO outputs) */
  inputs: WorkOrderInput[];
  /** Concrete deliverables — file paths, function names, behavior to produce */
  deliverables: string[];
  /** Acceptance criteria — explicit checks for done */
  acceptanceCriteria: string[];
  /** Current lifecycle status */
  status: WorkOrderStatus;
  /** Agent ID currently assigned (set when scheduled) */
  assignedTo?: string;
  /** Result populated when execution finishes */
  result?: WorkOrderResult;
  /** When the WO was created (epoch ms) */
  createdAt: number;
  /** When execution started */
  startedAt?: number;
  /** When execution ended */
  endedAt?: number;
}

/** Factory for constructing a WorkOrder from a planner's JSON output */
export function buildWorkOrder(raw: any, idx: number): WorkOrder {
  return {
    id: String(raw.id ?? `WO-${String(idx + 1).padStart(3, '0')}`),
    title: String(raw.title ?? raw.description?.substring(0, 60) ?? 'Untitled'),
    description: String(raw.description ?? ''),
    role: (raw.role ?? raw.agent ?? 'coder') as AgentRole,
    dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn.map(String) : [],
    inputs: Array.isArray(raw.inputs) ? raw.inputs.map((i: any) => ({
      type: (i.type ?? 'context') as WorkOrderInput['type'],
      ref: String(i.ref ?? ''),
      label: i.label
    })) : [],
    deliverables: Array.isArray(raw.deliverables) ? raw.deliverables.map(String) : [],
    acceptanceCriteria: Array.isArray(raw.acceptanceCriteria) ? raw.acceptanceCriteria.map(String) : [],
    status: 'pending',
    createdAt: Date.now()
  };
}

/** Render a WorkOrder for the agent's system prompt — must be human-readable */
export function renderWorkOrderForAgent(wo: WorkOrder, depResults: Map<string, WorkOrderResult>): string {
  const lines: string[] = [
    `# Work Order ${wo.id}: ${wo.title}`,
    `Role: ${wo.role}`,
    `Assigned to: ${wo.assignedTo ?? 'you'}`,
    '',
    `## Description`,
    wo.description,
    ''
  ];

  if (wo.deliverables.length > 0) {
    lines.push('## Deliverables (you must produce these)');
    for (const d of wo.deliverables) lines.push(`- ${d}`);
    lines.push('');
  }

  if (wo.acceptanceCriteria.length > 0) {
    lines.push('## Acceptance Criteria (your work is not done until these pass)');
    for (const c of wo.acceptanceCriteria) lines.push(`- ${c}`);
    lines.push('');
  }

  if (wo.inputs.length > 0) {
    lines.push('## Inputs (use these to inform your work)');
    for (const i of wo.inputs) {
      lines.push(`- [${i.type}] ${i.label ? `${i.label}: ` : ''}${i.ref}`);
    }
    lines.push('');
  }

  if (wo.dependsOn.length > 0) {
    lines.push('## Outputs from upstream Work Orders');
    for (const depId of wo.dependsOn) {
      const r = depResults.get(depId);
      if (r) {
        lines.push(`### From ${depId}`);
        lines.push(`Files modified: ${r.filesModified.join(', ') || 'none'}`);
        lines.push(`Summary: ${r.summary}`);
        lines.push('');
      }
    }
  }

  lines.push('## How to complete this WorkOrder');
  lines.push('1. Read inputs and dependency outputs first.');
  lines.push('2. Use file/shell tools to produce the deliverables.');
  lines.push('3. Verify each acceptance criterion is satisfied.');
  lines.push('4. If you are blocked (missing info, ambiguous spec), use ask_agent to query another agent.');
  lines.push('5. End with a brief summary of what you produced and how each criterion was met.');

  return lines.join('\n');
}

/** Build a result for a completed/failed WorkOrder from agent execution output */
export function buildWorkOrderResult(
  agentResult: {
    success: boolean;
    finalText: string;
    iterations: number;
    toolsUsed: string[];
    filesRead: string[];
    filesModified: string[];
    inputTokensEstimate: number;
    outputTokensEstimate: number;
    error?: string;
  },
  duration: number,
  cost: number,
  blockers?: string[]
): WorkOrderResult {
  return {
    filesCreated: agentResult.filesModified.filter(f => !agentResult.filesRead.includes(f)),
    filesModified: agentResult.filesModified,
    toolsUsed: agentResult.toolsUsed,
    summary: agentResult.finalText.split('\n').slice(0, 5).join(' ').substring(0, 300),
    blockers,
    iterations: agentResult.iterations,
    tokensUsed: agentResult.inputTokensEstimate + agentResult.outputTokensEstimate,
    cost,
    duration,
    finalText: agentResult.finalText,
    error: agentResult.error
  };
}
