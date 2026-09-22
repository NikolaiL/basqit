// Jev: 64k total; 32k for state + longest question. UTF-8 bytes are a
// conservative proxy, not its tokenizer. Leave room for provider formatting.
export function packQuestions<T>(state: unknown, questions: Record<string, T>): Record<string, T>[] {
  const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  const stateSize = size(state) + 1024;
  const batches: Record<string, T>[] = [];
  let batch: Record<string, T> = {};
  let used = stateSize;
  for (const [key, question] of Object.entries(questions)) {
    const bytes = size({ [key]: question }) + 512;
    if (stateSize + bytes > 24000) throw new Error("Discovery question exceeds input budget");
    if (used + bytes > 48000) {
      batches.push(batch);
      batch = {};
      used = stateSize;
    }
    batch[key] = question;
    used += bytes;
  }
  if (Object.keys(batch).length) batches.push(batch);
  return batches;
}
