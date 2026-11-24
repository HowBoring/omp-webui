import { expect, test } from "bun:test";
import { nativeWorkerFailureCode } from "../../packages/contracts/session-errors.ts";

test("the public native error boundary preserves known refusal/history codes and bounds unrecognized failures", () => {
  expect(nativeWorkerFailureCode("STRICT_OCCUPIED")).toBe("STRICT_OCCUPIED");
  expect(nativeWorkerFailureCode("history_stale_cursor")).toBe("history_stale_cursor");
  for (const value of [undefined, "STRICT_" + "A".repeat(200), "GENERATION_" + "A".repeat(200),
    "history_" + "a".repeat(200), "STRICT_SYNTHETIC_UNDECLARED", "/synthetic/private/path"]) {
    expect(nativeWorkerFailureCode(value)).toBe("RPC_NATIVE_REJECTED");
  }
});
