import { z } from "zod";
/** Host registration outcome, independent of native ownership and current worker state. */
export const sessionAttempt = z.strictObject({ state: z.enum(["registered", "opening", "open", "failed", "outcome_unknown", "closed"]),
  code: z.string().regex(/^[A-Z][A-Z0-9_]+$/).max(96).optional() });
export type SessionAttempt = z.infer<typeof sessionAttempt>;
