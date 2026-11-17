/** Original parent's dedicated input only. A command is accepted only with its complete clean EOF tail. */
export async function parentCommand(expected: string): Promise<void> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "", bytes = 0;
  for await (const chunk of Bun.stdin.stream()) {
    bytes += chunk.length;
    if (bytes > 128) throw new Error("DRAIN_PARENT_INPUT_LIMIT");
    text += decoder.decode(chunk, { stream: true });
  }
  if (text + decoder.decode() !== `${expected}\n`) throw new Error("DRAIN_PARENT_COMMAND");
}
export function drainFact(event: string, fields: object = {}): void {
  process.stdout.write(JSON.stringify({ event, ...fields, scope: "TWO_PROCESS_HELPER_FIXTURE_ONLY" }) + "\n");
}
export function boundedHelperOutput(stream: ReadableStream<Uint8Array>): Promise<string> {
  const result = (async () => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "", bytes = 0;
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > 4096) throw new Error("DRAIN_HELPER_OUTPUT_LIMIT");
      text += decoder.decode(chunk, { stream: true });
    }
    return text + decoder.decode();
  })();
  void result.catch(() => {});
  return result;
}
