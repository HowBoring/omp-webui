import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { NavigationOperationMetadata, NavigationOperationRepository } from "../../../packages/history-navigation-source/ports.ts";

interface Stored { version: 1; operations: NavigationOperationMetadata[] }
const empty = (): Stored => ({ version: 1, operations: [] });

/** Durable per-Host navigation receipts. Metadata only; no prompt text, tree, or target replay. */
export class NavigationOperationStore implements NavigationOperationRepository {
  readonly #file: string;
  #value: Stored;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.#file = join(dataDir, "history-navigation-operations.json");
    this.#value = this.#load();
  }

  #load(): Stored {
    if (!existsSync(this.#file)) return empty();
    try {
      const value = JSON.parse(readFileSync(this.#file, "utf8")) as Stored;
      return value?.version === 1 && Array.isArray(value.operations) ? value : empty();
    } catch { return empty(); }
  }

  #persist(next: Stored): boolean {
    const temporary = `${this.#file}.${process.pid}.tmp`;
    try {
      const fd = openSync(temporary, "w", 0o600);
      try { writeSync(fd, JSON.stringify(next)); } finally { closeSync(fd); }
      chmodSync(temporary, 0o600);
      renameSync(temporary, this.#file);
      this.#value = next;
      return true;
    } catch {
      try { unlinkSync(temporary); } catch { /* best effort */ }
      return false;
    }
  }

  async reserveUnknown(record: NavigationOperationMetadata, maxOperations: number): Promise<boolean> {
    const operations = this.#value.operations;
    if (operations.some(item => item.navigationId === record.navigationId)) return false;
    const sameWorker = operations.filter(item => item.scope.sourceId === record.scope.sourceId
      && item.scope.instanceId === record.scope.instanceId
      && item.scope.nativeSessionId === record.scope.nativeSessionId
      && item.state === "unknown");
    if (sameWorker.length > 0 || operations.length >= maxOperations) return false;
    return this.#persist({ version: 1, operations: [...operations, structuredClone(record)] });
  }

  async read(navigationId: string): Promise<NavigationOperationMetadata | undefined> {
    const found = this.#value.operations.find(item => item.navigationId === navigationId);
    return found ? structuredClone(found) : undefined;
  }

  async recordResult(record: NavigationOperationMetadata): Promise<void> {
    const operations = this.#value.operations;
    const index = operations.findIndex(item => item.navigationId === record.navigationId);
    const next = [...operations];
    if (index < 0) next.push(structuredClone(record)); else next[index] = structuredClone(record);
    if (!this.#persist({ version: 1, operations: next })) throw new Error("NAVIGATION_RECEIPT_UNAVAILABLE");
  }
}
