/**
 * AgentMailbox — Inter-agent communication during orchestration.
 *
 * Use cases:
 *   - Coder agent gets stuck on an architectural decision → asks the architect
 *   - Reviewer finds a bug → notifies the original coder to fix it
 *   - Security reviewer broadcasts a policy clarification to all coders
 *
 * Design:
 *   - Messages are persisted in-memory and to .orchestra-mailbox.json
 *     (so we can audit a session post-hoc)
 *   - send() is fire-and-forget; recipient sees the message at next poll
 *   - waitFor() blocks the caller until a reply arrives or timeout fires
 *   - This enables the `ask_agent` tool: agent A pauses while waiting
 *     for agent B's answer
 *
 * Concurrency note: this is a shared instance across the whole orchestration.
 * Single-process, JS event loop → no locks needed; but operations must not
 * await between read+write of the message store.
 */

import * as fs from 'fs';
import * as path from 'path';

export type MessageType =
  | 'question'    // Agent asks another agent for info
  | 'answer'     // Reply to a question
  | 'broadcast'  // To all agents
  | 'block'      // "I am blocked on X, somebody please resolve"
  | 'unblock'    // Resolution to a block
  | 'notify';    // FYI, no response expected

export interface AgentMessage {
  id: string;
  from: string;            // agent ID (e.g. "kimi-coder-001")
  to: string;              // agent ID OR 'broadcast'
  type: MessageType;
  subject: string;
  body: string;
  /** Work order this message relates to (optional but recommended) */
  workOrderId?: string;
  /** If this is an answer, the question's message ID */
  replyTo?: string;
  /** Epoch ms */
  timestamp: number;
  /** Whether the recipient has seen it */
  read: boolean;
}

export interface MailboxStats {
  totalSent: number;
  totalDelivered: number;
  pendingByAgent: Record<string, number>;
  conversations: number;
}

export class AgentMailbox {
  private messages: AgentMessage[] = [];
  private waiters = new Map<string, { resolve: (m: AgentMessage) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private nextId = 1;
  private persistPath?: string;
  private listeners = new Set<(m: AgentMessage) => void>();

  constructor(workspaceRoot?: string) {
    if (workspaceRoot) {
      this.persistPath = path.join(workspaceRoot, '.orchestra-mailbox.json');
    }
  }

  /** Send a message. Fire-and-forget (no await). */
  send(msg: Omit<AgentMessage, 'id' | 'timestamp' | 'read'>): AgentMessage {
    const full: AgentMessage = {
      ...msg,
      id: `msg-${String(this.nextId++).padStart(4, '0')}`,
      timestamp: Date.now(),
      read: false
    };
    this.messages.push(full);
    this.persist();

    // Notify any in-flight waiters watching for this message as a reply
    if (full.replyTo) {
      const w = this.waiters.get(full.replyTo);
      if (w) {
        clearTimeout(w.timer);
        this.waiters.delete(full.replyTo);
        full.read = true;
        w.resolve(full);
      }
    }

    // Notify general listeners
    for (const l of this.listeners) {
      try { l(full); } catch { /* listener errors don't affect delivery */ }
    }

    return full;
  }

  /**
   * Block until we receive a reply to a specific message ID, or timeout.
   * Used by ask_agent tool: agent A sends a question, then waits for the answer.
   */
  waitForReply(questionId: string, timeoutMs: number = 60000): Promise<AgentMessage> {
    return new Promise((resolve, reject) => {
      // Already arrived?
      const existing = this.messages.find(m => m.replyTo === questionId);
      if (existing) {
        existing.read = true;
        resolve(existing);
        return;
      }

      const timer = setTimeout(() => {
        this.waiters.delete(questionId);
        reject(new Error(`Timeout (${timeoutMs}ms) waiting for reply to ${questionId}`));
      }, timeoutMs);

      this.waiters.set(questionId, { resolve, reject, timer });
    });
  }

  /** Get unread messages addressed to an agent (or broadcast) */
  inbox(agentId: string, includeRead: boolean = false): AgentMessage[] {
    return this.messages.filter(m =>
      (m.to === agentId || m.to === 'broadcast') &&
      (includeRead || !m.read)
    );
  }

  /** Mark a message as read */
  markRead(messageId: string): void {
    const m = this.messages.find(x => x.id === messageId);
    if (m) {
      m.read = true;
      this.persist();
    }
  }

  /** Subscribe to all new messages (for the UI/Director to react in real time) */
  subscribe(listener: (m: AgentMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Full conversation history (for export/audit) */
  history(): AgentMessage[] {
    return [...this.messages];
  }

  /** Conversation thread starting from a question */
  thread(questionId: string): AgentMessage[] {
    const root = this.messages.find(m => m.id === questionId);
    if (!root) return [];
    const replies = this.messages.filter(m => m.replyTo === questionId);
    return [root, ...replies];
  }

  stats(): MailboxStats {
    const pending: Record<string, number> = {};
    let conversations = 0;
    for (const m of this.messages) {
      if (!m.read) pending[m.to] = (pending[m.to] ?? 0) + 1;
      if (m.type === 'question') conversations++;
    }
    return {
      totalSent: this.messages.length,
      totalDelivered: this.messages.filter(m => m.read).length,
      pendingByAgent: pending,
      conversations
    };
  }

  /** Clear pending waiters (e.g. when orchestration aborts) */
  abort(): void {
    for (const [id, w] of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error('Orchestration aborted'));
    }
    this.waiters.clear();
  }

  private persist(): void {
    if (!this.persistPath) return;
    try {
      fs.writeFileSync(this.persistPath, JSON.stringify(this.messages, null, 2));
    } catch { /* persistence is best-effort */ }
  }
}
