import type { SubmissionCausality } from './candidates/durable-submission-v1/omp-wire.ts';
import type { HistoryCut, HistoryItem, HistoryLiveIdentity } from './generated/omp-wire.ts';

/** Authored public active-history-index-v1 contract, pending matched SDK/codec generation. */
export interface ActiveHistoryBinding { snapshot: string; contentRevision: string }
export interface ActiveHistoryEntryKey { ordinal: number; entryId: string; digest: string }
export interface ActiveHistoryEntry extends ActiveHistoryEntryKey {
  parentId: string | null;
  kind: string;
  role?: string;
  provider?: string;
  model?: string;
  stopReason?: string;
  /** Presentation-only parsed calls retained by the native index for coordinate accounting. */
  toolCallCount?: number;
  live?: HistoryLiveIdentity;
}
interface ActiveHistoryEnvelope { snapshot: string; cut: HistoryCut; expiresAt: number }
export interface ActiveHistoryOpen extends ActiveHistoryEnvelope {
  version: 'active-history-index-v1';
  count: number;
  indexBytes: number;
  scannedBytes: number;
  streaming: boolean;
}
export interface ActiveHistoryIndexPage extends ActiveHistoryEnvelope {
  items: ActiveHistoryEntry[];
  nextOrdinal?: number;
}
export interface ActiveHistoryPosition { ordinal: number; partIndex: number }
export interface ActiveHistoryRange extends ActiveHistoryEnvelope {
  items: (HistoryItem & { submission?: SubmissionCausality })[];
  next?: ActiveHistoryPosition;
}

/**
 * Dormant typed data port for the four authored public Native commands. A production implementation requires
 * the exact generated codec and matched public carrier to verify response correlation and schema before delivery.
 */
export interface ActiveHistorySource {
  open(): Promise<ActiveHistoryOpen>;
  index(binding: ActiveHistoryBinding, start: number): Promise<ActiveHistoryIndexPage>;
  range(binding: ActiveHistoryBinding, entries: ActiveHistoryEntryKey[], startPart: number):
    Promise<ActiveHistoryRange>;
  close(binding: ActiveHistoryBinding): Promise<{ closed: boolean }>;
}
