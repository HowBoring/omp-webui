/**
 * S5 performance corpus history authoring only. Spawned by
 * scripts/create-performance-corpus.ts with native OMP session env.
 *
 * The pinned manager is loaded at runtime so this authoring script does not pull
 * the vendored OMP source graph into the repository's script typecheck.
 */
type AuthoringManager = {
	ensureOnDisk(): Promise<void>;
	appendCompaction(summary: string, shortSummary: string | undefined, firstKeptEntryId: string, tokensBefore: number): string;
	appendResetBoundary(): string;
	appendMessageToBranch(message: unknown, parentId: string | null): string;
	appendMessage(message: unknown): string;
	appendCustomEntry(customType: string, data?: unknown): string;
	flush(): Promise<void>;
	getSessionFile(): string;
	close(): Promise<void>;
};
const managerModule = new URL("../vendor/omp/packages/coding-agent/src/session/session-manager.ts", import.meta.url).pathname;
const { SessionManager } = await import(managerModule) as {
	SessionManager: { create(cwd: string, sessionDir?: string): AuthoringManager };
};

const ENTRIES = 10_000;
const LONG_TEXT_BYTES = 13_824;

const padded = (index: number, bytes = LONG_TEXT_BYTES): string => {
	const head = `Entry ${index} 数据 📜 `;
	const tail = "…";
	return head + "x".repeat(Math.max(0, bytes - Buffer.byteLength(head) - Buffer.byteLength(tail))) + tail;
};

const assistant = (text: string, timestamp: number) => ({
	role: "assistant" as const,
	content: [{ type: "text" as const, text }],
	api: "openai-completions" as const,
	provider: "s0-controlled" as const,
	model: "deterministic-live" as const,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "stop" as const,
	timestamp,
});

const home = process.argv[2];
if (!home) throw new Error("PERFORMANCE_HISTORY_HOME_MISSING");
const manager = SessionManager.create(`${home}/project`, `${home}/sessions/performance-project`);
await manager.ensureOnDisk();
const users: string[] = [];
let last = "";
for (let index = 0; index < ENTRIES; index++) {
	const timestamp = 1_767_225_601_000 + index * 1_000;
	const slot = index % 10;
	if (index % 1_000 === 999) {
		manager.appendCompaction(padded(index), "S5 deterministic compaction", users.at(-1) ?? last, 100_000);
	} else if (index % 500 === 499) {
		manager.appendResetBoundary();
	} else if (index % 100 === 3) {
		manager.appendMessageToBranch(
			{ role: "user", content: [{ type: "text", text: `Abandoned branch probe ${index}` }], timestamp },
			users[index % Math.max(1, users.length)] ?? null,
		);
	} else if (slot === 0) {
		last = manager.appendMessage({ role: "user", content: [{ type: "text", text: padded(index) }], timestamp });
		users.push(last);
	} else if (slot === 1) {
		last = manager.appendMessage({
			...assistant("", timestamp),
			content: [{
				type: "toolCall",
				id: `call-${String(index).padStart(5, "0")}`,
				name: "read",
				arguments: { path: `src/file-${index}.ts` },
			}],
			stopReason: "toolUse",
		});
	} else if (slot === 2) {
		last = manager.appendMessage({
			role: "toolResult",
			toolCallId: `call-${String(index - 1).padStart(5, "0")}`,
			toolName: "read",
			content: [{ type: "text", text: padded(index) }],
			isError: false,
			timestamp,
		});
	} else if (slot === 3) {
		last = manager.appendMessage(assistant(padded(index), timestamp));
	} else if (slot === 4) {
		last = manager.appendMessage({
			role: "user",
			content: [{ type: "text", text: `Short follow-up ${index}` }],
			timestamp,
		});
		users.push(last);
	} else if (slot === 5) {
		last = manager.appendMessage({
			role: "fileMention",
			files: [{ path: `src/mention-${index}.ts`, content: padded(index), byteSize: LONG_TEXT_BYTES }],
			timestamp,
		});
	} else if (slot === 6) {
		last = manager.appendMessage(assistant(padded(index), timestamp));
	} else if (slot === 7) {
		last = manager.appendCustomEntry("s5.performance-marker", { index, payload: padded(index) });
	} else if (slot === 8) {
		last = manager.appendMessage({ role: "user", content: [{ type: "text", text: padded(index) }], timestamp });
		users.push(last);
	} else {
		last = manager.appendMessage(assistant(padded(index), timestamp));
	}
}
await manager.flush();
const file = manager.getSessionFile();
if (!file) throw new Error("PERFORMANCE_HISTORY_FILE_MISSING");
await manager.close();
process.stdout.write(JSON.stringify({ file }));
