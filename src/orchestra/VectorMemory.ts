/**
 * VectorMemory — TF-IDF based semantic search over orchestration outputs.
 *
 * Why TF-IDF instead of real embeddings?
 *   - Zero dependencies (no llama.cpp, no API calls, no Pinecone/Chroma)
 *   - Fast: tokenize → score → cosine similarity, all in pure JS
 *   - Good enough for "what did the architect say about JWT?" type queries
 *     over a corpus of dozens of WO outputs and mailbox messages
 *   - Trivial to swap later for real embeddings if needed (the public
 *     interface is store/search/getRelevant)
 *
 * What it indexes:
 *   - Each WorkOrder result (full text + metadata)
 *   - Each mailbox message (subject + body)
 *   - Project context files (CLAUDE.md etc) — chunked into paragraphs
 *
 * What it does NOT do (yet):
 *   - Stemming (we use raw tokens)
 *   - Stop word removal beyond the most common 20 English/Spanish words
 *   - Semantic embeddings (no synonyms — "auth" and "authentication" are
 *     different terms)
 *
 * Use case: when a coder agent asks "what context is relevant to JWT?",
 * we search the memory and inject the top-K most similar entries into
 * the system prompt instead of dumping the entire conversation.
 */

const STOP_WORDS = new Set([
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
  'could', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
  'ought', 'used', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'them',
  'their', 'what', 'which', 'who', 'whom', 'this', 'that', 'these',
  'those', 'am', 'and', 'but', 'if', 'or', 'because', 'as', 'until',
  'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between',
  'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to',
  'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
  'very', 's', 't', 'just', 'don', 'now',
  // Spanish
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o',
  'pero', 'que', 'de', 'del', 'al', 'a', 'en', 'por', 'para', 'con',
  'sin', 'sobre', 'entre', 'es', 'son', 'fue', 'fueron', 'sea', 'ser',
  'esta', 'estas', 'este', 'estos', 'eso', 'esa', 'aquel', 'aquella',
  'su', 'sus', 'mi', 'mis', 'tu', 'tus', 'nos', 'os', 'lo', 'le', 'les',
  'me', 'te', 'se', 'no', 'si', 'como', 'cuando', 'donde', 'porque',
  'todo', 'todos', 'todas', 'cada', 'mas', 'menos', 'muy', 'mucho',
  'poco', 'tanto', 'tan'
]);

export interface MemoryEntry {
  id: string;
  /** Type: 'workorder' | 'message' | 'context' | 'custom' */
  kind: string;
  /** Text content to be searched */
  text: string;
  /** Optional metadata (agent ID, file path, etc.) */
  metadata?: Record<string, any>;
  /** Epoch ms when added */
  timestamp: number;
}

interface ScoredEntry {
  entry: MemoryEntry;
  score: number;
}

export class VectorMemory {
  private entries: MemoryEntry[] = [];
  /** Tokenized form of each entry, cached after first tokenize */
  private tokenized = new Map<string, string[]>();
  /** Document frequency: how many entries contain each token */
  private docFreq = new Map<string, number>();
  /** Whether the IDF cache is dirty */
  private dirty = true;

  /** Add an entry to the memory */
  add(entry: Omit<MemoryEntry, 'timestamp'>): void {
    const full: MemoryEntry = { ...entry, timestamp: Date.now() };
    this.entries.push(full);
    const tokens = this.tokenize(full.text);
    this.tokenized.set(full.id, tokens);
    this.dirty = true;
  }

  /** Remove an entry by ID */
  remove(id: string): void {
    this.entries = this.entries.filter(e => e.id !== id);
    this.tokenized.delete(id);
    this.dirty = true;
  }

  /** Get all entries */
  getAll(): MemoryEntry[] {
    return [...this.entries];
  }

  /** Get entries by kind */
  getByKind(kind: string): MemoryEntry[] {
    return this.entries.filter(e => e.kind === kind);
  }

  /**
   * Search for entries semantically similar to the query.
   * Returns top-K entries sorted by relevance.
   */
  search(query: string, topK: number = 5): MemoryEntry[] {
    if (this.entries.length === 0) return [];

    if (this.dirty) this.rebuildDocFreq();

    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return [];

    const queryVec = this.vectorize(queryTokens);
    const queryNorm = this.norm(queryVec);
    if (queryNorm === 0) return [];

    const scored: ScoredEntry[] = this.entries.map(entry => {
      const tokens = this.tokenized.get(entry.id) ?? [];
      const docVec = this.vectorize(tokens);
      const docNorm = this.norm(docVec);
      if (docNorm === 0) return { entry, score: 0 };
      const dot = this.dotProduct(queryVec, docVec);
      return { entry, score: dot / (queryNorm * docNorm) };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => s.entry);
  }

  /** Format the most relevant entries as a context block for an agent prompt */
  getRelevantContext(query: string, topK: number = 3, maxChars: number = 3000): string {
    const results = this.search(query, topK);
    if (results.length === 0) return '';

    const lines = ['# Relevant context from prior orchestration:'];
    let used = lines[0].length;

    for (const r of results) {
      const header = `\n## ${r.kind} ${r.id}${r.metadata?.agentId ? ` (${r.metadata.agentId})` : ''}`;
      const body = r.text.substring(0, Math.min(800, maxChars - used - header.length));
      if (used + header.length + body.length > maxChars) break;
      lines.push(header);
      lines.push(body);
      used += header.length + body.length;
    }

    return lines.join('\n');
  }

  /** Stats for telemetry */
  stats(): { totalEntries: number; uniqueTerms: number; byKind: Record<string, number> } {
    const byKind: Record<string, number> = {};
    for (const e of this.entries) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    if (this.dirty) this.rebuildDocFreq();
    return {
      totalEntries: this.entries.length,
      uniqueTerms: this.docFreq.size,
      byKind
    };
  }

  // --- Internal: TF-IDF math ---

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2 && t.length <= 30 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
  }

  private rebuildDocFreq(): void {
    this.docFreq.clear();
    for (const entry of this.entries) {
      const tokens = this.tokenized.get(entry.id) ?? this.tokenize(entry.text);
      this.tokenized.set(entry.id, tokens);
      const seen = new Set(tokens);
      for (const t of seen) this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
    }
    this.dirty = false;
  }

  private vectorize(tokens: string[]): Map<string, number> {
    const N = this.entries.length || 1;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    const vec = new Map<string, number>();
    for (const [term, count] of tf) {
      const df = this.docFreq.get(term) ?? 1;
      const idf = Math.log((N + 1) / (df + 1)) + 1;
      vec.set(term, count * idf);
    }
    return vec;
  }

  private norm(vec: Map<string, number>): number {
    let sum = 0;
    for (const v of vec.values()) sum += v * v;
    return Math.sqrt(sum);
  }

  private dotProduct(a: Map<string, number>, b: Map<string, number>): number {
    let sum = 0;
    const [smaller, larger] = a.size < b.size ? [a, b] : [b, a];
    for (const [k, v] of smaller) {
      const w = larger.get(k);
      if (w !== undefined) sum += v * w;
    }
    return sum;
  }
}
