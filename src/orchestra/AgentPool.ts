/**
 * AgentPool - Manages concurrent agent instances per provider.
 *
 * Each provider has a different concurrency budget:
 *   - Kimi:     300 concurrent (massively parallel)
 *   - DeepSeek:  50 concurrent (high)
 *   - MiMo:      10 concurrent (Token Plan, conservative)
 *   - Claude:     5 concurrent (strict rate limits)
 *
 * The pool uses a semaphore per provider. When a subtask needs an agent,
 * it calls acquire(provider) which blocks until a slot is free, then
 * returns an AgentInstance with a unique ID. release() frees the slot.
 *
 * This means you can have e.g. 300 Kimi agents working in parallel on
 * 300 independent subtasks, all sharing the same provider.
 */

import { AICodingProvider } from '../providers/BaseProvider';

/** Default concurrency limits per provider — can be overridden via config */
export const DEFAULT_LIMITS: Record<string, number> = {
  kimi: 300,
  deepseek: 50,
  mimo: 10,
  claude: 5
};

export interface AgentInstance {
  /** Unique ID like "kimi-coder-001", "mimo-coder-007" */
  id: string;
  provider: AICodingProvider;
  modelId: string;
  /** Role hint for telemetry — "coder", "reviewer", etc. */
  role?: string;
  /** Release this instance back to the pool */
  release: () => void;
}

interface PoolEntry {
  limit: number;
  inUse: number;
  /** Maximum concurrent instances ever held during this pool's lifetime */
  peakInUse: number;
  /** Total instances acquired (including those already released) */
  totalAcquired: number;
  /** Pending acquire() calls waiting for a slot */
  waiters: Array<() => void>;
  /** Counter for unique instance IDs per provider+role */
  counter: Map<string, number>;
}

export class AgentPool {
  private pools = new Map<string, PoolEntry>();

  constructor(limits: Record<string, number> = DEFAULT_LIMITS) {
    for (const [name, limit] of Object.entries(limits)) {
      this.pools.set(name, { limit, inUse: 0, peakInUse: 0, totalAcquired: 0, waiters: [], counter: new Map() });
    }
  }

  /** Configure or override a provider's concurrency limit */
  setLimit(providerName: string, limit: number): void {
    const entry = this.pools.get(providerName);
    if (entry) {
      entry.limit = limit;
      // Wake up waiters if we just increased the limit
      this.drain(providerName);
    } else {
      this.pools.set(providerName, { limit, inUse: 0, peakInUse: 0, totalAcquired: 0, waiters: [], counter: new Map() });
    }
  }

  /**
   * Acquire an agent instance for a provider+role. Blocks until a slot is free.
   * Caller MUST call instance.release() when done (use try/finally).
   */
  async acquire(provider: AICodingProvider, modelId: string, role: string = 'agent'): Promise<AgentInstance> {
    const entry = this.pools.get(provider.name) ?? this.ensurePool(provider.name);

    // Wait for a slot
    if (entry.inUse >= entry.limit) {
      await new Promise<void>(resolve => entry.waiters.push(resolve));
    }

    entry.inUse++;
    entry.totalAcquired++;
    if (entry.inUse > entry.peakInUse) entry.peakInUse = entry.inUse;
    const n = (entry.counter.get(role) ?? 0) + 1;
    entry.counter.set(role, n);
    const id = `${provider.name}-${role}-${String(n).padStart(3, '0')}`;

    return {
      id,
      provider,
      modelId,
      role,
      release: () => this.releaseSlot(provider.name)
    };
  }

  /** Quick check — current/peak/total counters for a provider */
  getUsage(providerName: string): { inUse: number; peak: number; total: number; limit: number; waiting: number } {
    const e = this.pools.get(providerName);
    if (!e) return { inUse: 0, peak: 0, total: 0, limit: 0, waiting: 0 };
    return { inUse: e.inUse, peak: e.peakInUse, total: e.totalAcquired, limit: e.limit, waiting: e.waiters.length };
  }

  /** Snapshot of all pools for telemetry */
  getAllUsage(): Record<string, { inUse: number; peak: number; total: number; limit: number; waiting: number }> {
    const out: Record<string, { inUse: number; peak: number; total: number; limit: number; waiting: number }> = {};
    for (const name of this.pools.keys()) {
      out[name] = this.getUsage(name);
    }
    return out;
  }

  private ensurePool(providerName: string): PoolEntry {
    const entry: PoolEntry = {
      limit: DEFAULT_LIMITS[providerName] ?? 5,
      inUse: 0,
      peakInUse: 0,
      totalAcquired: 0,
      waiters: [],
      counter: new Map()
    };
    this.pools.set(providerName, entry);
    return entry;
  }

  private releaseSlot(providerName: string): void {
    const entry = this.pools.get(providerName);
    if (!entry) return;
    entry.inUse = Math.max(0, entry.inUse - 1);
    this.drain(providerName);
  }

  private drain(providerName: string): void {
    const entry = this.pools.get(providerName);
    if (!entry) return;
    while (entry.waiters.length > 0 && entry.inUse < entry.limit) {
      const next = entry.waiters.shift()!;
      next();
    }
  }
}
