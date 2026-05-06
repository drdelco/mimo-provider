/**
 * OrchestraTools — Extra tools available only when an agent runs inside
 * the Orchestra (i.e., during a multi-agent orchestration).
 *
 * These tools require runtime context (the mailbox, the calling agent's ID,
 * available peer agents) that does not exist in the regular chat flow. We
 * use a per-execution context that the AgentExecutor sets before each
 * tool call and clears after.
 *
 * Tools added:
 *   - ask_agent:   Send a question to another agent and wait for the answer
 *   - notify:      Fire-and-forget message to another agent (no wait)
 *   - broadcast:   Send a message to all agents in the orchestration
 *   - check_inbox: Read pending messages addressed to me
 */

import { ToolDefinition, ToolCall } from '../providers/BaseProvider';
import { AgentMailbox, AgentMessage } from './Mailbox';

export interface OrchestraToolContext {
  mailbox: AgentMailbox;
  /** Calling agent's ID */
  agentId: string;
  /** Other agent IDs available to talk to */
  peers: string[];
  /** Work order this agent is currently executing */
  workOrderId?: string;
}

/** Per-async-context store; set before each tool call */
let activeContext: OrchestraToolContext | undefined;

export function setOrchestraContext(ctx: OrchestraToolContext | undefined): void {
  activeContext = ctx;
}

export function getOrchestraContext(): OrchestraToolContext | undefined {
  return activeContext;
}

export const ORCHESTRA_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'ask_agent',
      description: 'Send a question to another agent in the orchestration and wait for their reply. Use when you need clarification, expertise, or a decision from a peer agent (e.g. coder asking architect about design choices).',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Target agent ID (must be one of the peers listed in your context)' },
          subject: { type: 'string', description: 'Brief subject of the question' },
          question: { type: 'string', description: 'The full question. Be specific.' },
          timeout_ms: { type: 'number', description: 'Max ms to wait for reply (default 60000)' }
        },
        required: ['to', 'subject', 'question']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'notify',
      description: 'Send a fire-and-forget message to another agent. Use to inform without blocking (e.g. "I have finished file X" or "you should re-review file Y").',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Target agent ID' },
          subject: { type: 'string' },
          body: { type: 'string' }
        },
        required: ['to', 'subject', 'body']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'broadcast',
      description: 'Send a message to all agents in the orchestration. Use sparingly — for policy decisions or general alerts.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          body: { type: 'string' }
        },
        required: ['subject', 'body']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_inbox',
      description: 'Read pending messages addressed to you. Returns a list of unread messages.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  }
];

/** Returns true if this tool name is an Orchestra tool */
export function isOrchestraTool(name: string): boolean {
  return ORCHESTRA_TOOLS.some(t => t.function.name === name);
}

/** Execute an Orchestra tool. Returns the result text. */
export async function executeOrchestraTool(toolCall: ToolCall): Promise<string> {
  const ctx = getOrchestraContext();
  if (!ctx) {
    return `Error: ${toolCall.function.name} is only available inside an Orchestra execution.`;
  }

  let args: any = {};
  try { args = JSON.parse(toolCall.function.arguments); } catch { /* malformed args */ }

  switch (toolCall.function.name) {
    case 'ask_agent': {
      const { to, subject, question, timeout_ms } = args;
      if (!to || !question) return 'Error: ask_agent requires "to" and "question"';
      if (!ctx.peers.includes(to)) {
        return `Error: agent "${to}" is not a peer. Available peers: ${ctx.peers.join(', ')}`;
      }

      const sent = ctx.mailbox.send({
        from: ctx.agentId,
        to,
        type: 'question',
        subject: String(subject ?? '(no subject)'),
        body: String(question),
        workOrderId: ctx.workOrderId
      });

      try {
        const reply = await ctx.mailbox.waitForReply(sent.id, timeout_ms ?? 60000);
        return `Reply from ${reply.from}:\n\nSubject: ${reply.subject}\n\n${reply.body}`;
      } catch (err: any) {
        return `Did not get a reply from ${to}: ${err.message}. Decide based on your best judgment and proceed.`;
      }
    }

    case 'notify': {
      const { to, subject, body } = args;
      if (!to || !body) return 'Error: notify requires "to" and "body"';
      if (!ctx.peers.includes(to)) {
        return `Error: agent "${to}" is not a peer. Available: ${ctx.peers.join(', ')}`;
      }
      const sent = ctx.mailbox.send({
        from: ctx.agentId,
        to,
        type: 'notify',
        subject: String(subject ?? '(no subject)'),
        body: String(body),
        workOrderId: ctx.workOrderId
      });
      return `Notification sent to ${to} (${sent.id})`;
    }

    case 'broadcast': {
      const { subject, body } = args;
      if (!body) return 'Error: broadcast requires "body"';
      const sent = ctx.mailbox.send({
        from: ctx.agentId,
        to: 'broadcast',
        type: 'broadcast',
        subject: String(subject ?? '(no subject)'),
        body: String(body),
        workOrderId: ctx.workOrderId
      });
      return `Broadcast sent (${sent.id}). Reaches all ${ctx.peers.length} peers.`;
    }

    case 'check_inbox': {
      const inbox = ctx.mailbox.inbox(ctx.agentId);
      if (inbox.length === 0) return 'Inbox is empty.';
      const lines = inbox.map(m => {
        ctx.mailbox.markRead(m.id);
        return `[${m.id}] from ${m.from} (${m.type}) — ${m.subject}\n${m.body}`;
      });
      return `${inbox.length} message(s):\n\n${lines.join('\n\n---\n\n')}`;
    }

    default:
      return `Unknown orchestra tool: ${toolCall.function.name}`;
  }
}
