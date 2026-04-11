/**
 * Conversation context management — compression and persistence.
 *
 * Instead of dropping old messages, we extract structured metadata
 * (files read, files modified, commands run, last summary) and keep
 * the recent messages intact. This preserves context without hitting
 * the model's token limit.
 */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

/**
 * Compress conversation history when it grows too long.
 *
 * - If <= `threshold` messages, return as-is.
 * - Otherwise, keep the last `keepRecent` messages intact and compress
 *   the older messages into a single structured summary.
 */
export function compressHistory(
  messages: ChatMessage[],
  threshold = 40,
  keepRecent = 20
): ChatMessage[] {
  if (messages.length <= threshold) return messages;

  const recent = messages.slice(-keepRecent);
  const old = messages.slice(0, -keepRecent);

  const filesRead = new Set<string>();
  const filesModified = new Set<string>();
  const commandsRun: string[] = [];
  const searchesDone: string[] = [];

  for (const msg of old) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        try {
          const args = JSON.parse(tc.function.arguments);
          switch (tc.function.name) {
            case 'read_file':
              filesRead.add(args.path);
              break;
            case 'write_file':
            case 'edit_file':
              filesModified.add(args.path);
              break;
            case 'run_terminal':
              commandsRun.push(args.command.substring(0, 100));
              break;
            case 'search_files':
              searchesDone.push(args.pattern);
              break;
          }
        } catch { /* skip malformed tool calls */ }
      }
    }
  }

  // Find the last substantive assistant response in the old messages
  let lastAssistantText = '';
  for (let i = old.length - 1; i >= 0; i--) {
    if (old[i].role === 'assistant' && old[i].content && !old[i].tool_calls) {
      lastAssistantText = old[i].content.substring(0, 1500);
      break;
    }
  }

  // Find the original user request (first user message)
  let originalRequest = '';
  for (const msg of old) {
    if (msg.role === 'user' && !msg.content.startsWith('[Compressed') && !msg.content.startsWith('PUNTO DE CONTROL')) {
      originalRequest = msg.content.substring(0, 500);
      break;
    }
  }

  const parts: string[] = [
    `[Compressed context — ${old.length} earlier messages summarized]`
  ];
  if (originalRequest) {
    parts.push(`Original request: ${originalRequest}`);
  }
  if (filesRead.size > 0) {
    parts.push(`Files examined: ${[...filesRead].join(', ')}`);
  }
  if (filesModified.size > 0) {
    parts.push(`Files modified: ${[...filesModified].join(', ')}`);
  }
  if (commandsRun.length > 0) {
    parts.push(`Commands run: ${commandsRun.slice(-8).join(' ; ')}`);
  }
  if (searchesDone.length > 0) {
    parts.push(`Searches: ${searchesDone.slice(-5).join(', ')}`);
  }
  if (lastAssistantText) {
    parts.push(`Last assistant summary:\n${lastAssistantText}`);
  }

  return [
    { role: 'user', content: parts.join('\n') },
    ...recent
  ];
}

/**
 * Serialize conversation history for persistence (workspaceState).
 * Strips tool_calls details to save space — only keeps names.
 */
export function serializeHistory(messages: ChatMessage[]): string {
  const slim = messages.map(m => {
    if (m.tool_calls) {
      return {
        ...m,
        tool_calls: m.tool_calls.map(tc => ({
          id: tc.id,
          function: { name: tc.function.name, arguments: tc.function.arguments }
        }))
      };
    }
    return m;
  });
  return JSON.stringify(slim);
}

/**
 * Deserialize conversation history from persistence.
 */
export function deserializeHistory(data: string): ChatMessage[] {
  try {
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* corrupt data */ }
  return [];
}
