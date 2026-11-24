import { PrivateHelperError } from "./errors.ts";

/** Internal trusted control only. These frames never share Native stdout or a browser transport. */
export const PRIVATE_CONTROL_LIMITS = Object.freeze({ frameBytes: 512, framesPerChunk: 32, generationBytes: 64 });
export type PrivateCommand = "START" | "ORDINARY_STOP" | "FORCE" | "MANDATORY" | "STATUS";
export type PrivatePhase = "waiting" | "running" | "ordinary" | "cooperative" | "term" | "kill" | "incomplete";
export interface PrivateHello {
  kind: "hello"; generation: string; helperPid: number; helperStartTime: string;
  nativePid: number; nativeStartTime: string;
}
export type PrivateEvent = PrivateHello
  | { kind: "state"; generation: string; phase: PrivatePhase }
  | { kind: "rootExit"; generation: string; exitCode: number; signal: number }
  | { kind: "complete"; generation: string };

export class PrivateControlError extends PrivateHelperError {
  constructor(code: "CONTROL_PROTOCOL" | "CONTROL_LIMIT" | "CONTROL_GENERATION") { super(code); }
}
export function privateGeneration(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new PrivateControlError("CONTROL_GENERATION");
  return value;
}
function decimal(value: string | undefined, positive = true): number {
  if (!value || !/^(0|[1-9][0-9]{0,9})$/.test(value)) throw new PrivateControlError("CONTROL_PROTOCOL");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > 2_147_483_647 || (positive && number === 0)) {
    throw new PrivateControlError("CONTROL_PROTOCOL");
  }
  return number;
}
function startTime(value: string | undefined): string {
  if (!value || !/^[1-9][0-9]{0,19}$/.test(value)) throw new PrivateControlError("CONTROL_PROTOCOL");
  return value;
}
function parse(frame: string, generation: string): PrivateEvent {
  const parts = frame.split(" ");
  if (parts[1] !== generation) throw new PrivateControlError("CONTROL_GENERATION");
  if (parts[0] === "HELLO" && parts.length === 6) {
    const helperPid = decimal(parts[2]);
    const nativePid = decimal(parts[4]);
    if (helperPid === nativePid) throw new PrivateControlError("CONTROL_PROTOCOL");
    return { kind: "hello", generation, helperPid, helperStartTime: startTime(parts[3]),
      nativePid, nativeStartTime: startTime(parts[5]) };
  }
  if (parts[0] === "STATE" && parts.length === 3) {
    const phase = parts[2];
    if (phase === "waiting" || phase === "running" || phase === "ordinary" || phase === "cooperative"
      || phase === "term" || phase === "kill" || phase === "incomplete") return { kind: "state", generation, phase };
  }
  if (parts[0] === "ROOT_EXIT" && parts.length === 4) {
    const exitCode = decimal(parts[2], false);
    const signal = decimal(parts[3], false);
    if (exitCode > 255 || signal > 64 || (signal !== 0 && exitCode !== 0)) {
      throw new PrivateControlError("CONTROL_PROTOCOL");
    }
    return { kind: "rootExit", generation, exitCode, signal };
  }
  if (parts[0] === "COMPLETE" && parts.length === 2) return { kind: "complete", generation };
  throw new PrivateControlError("CONTROL_PROTOCOL");
}

/** Strict bounded ASCII decoder. Protocol errors poison the stream; callers close control to start fail-safe drain. */
export class ControlDecoder {
  readonly #generation: string;
  #frame = "";
  #failed = false;
  constructor(generation: string) { this.#generation = privateGeneration(generation); }
  push(bytes: Uint8Array): PrivateEvent[] {
    if (this.#failed) throw new PrivateControlError("CONTROL_PROTOCOL");
    const events: PrivateEvent[] = [];
    try {
      for (const byte of bytes) {
        if (byte === 10) {
          if (events.length === PRIVATE_CONTROL_LIMITS.framesPerChunk) throw new PrivateControlError("CONTROL_LIMIT");
          events.push(parse(this.#frame, this.#generation));
          this.#frame = "";
        } else {
          if (byte < 32 || byte > 126) throw new PrivateControlError("CONTROL_PROTOCOL");
          if (this.#frame.length >= PRIVATE_CONTROL_LIMITS.frameBytes - 1) throw new PrivateControlError("CONTROL_LIMIT");
          this.#frame += String.fromCharCode(byte);
        }
      }
      return events;
    } catch (error) { this.#failed = true; throw error; }
  }
  finish(): void {
    if (this.#failed || this.#frame.length !== 0) throw new PrivateControlError("CONTROL_PROTOCOL");
  }
}
export function encodeControlCommand(command: PrivateCommand, generation: string): Uint8Array {
  if (!["START", "ORDINARY_STOP", "FORCE", "MANDATORY", "STATUS"].includes(command)) {
    throw new PrivateControlError("CONTROL_PROTOCOL");
  }
  return new TextEncoder().encode(`${command} ${privateGeneration(generation)}\n`);
}
