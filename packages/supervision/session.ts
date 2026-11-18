import { PrivateHelperError, helperError } from "./errors.ts";
import { encodeControlCommand, privateGeneration, type PrivateCommand, type PrivateEvent, type PrivateHello } from "./control.ts";

export interface PrivateControlSystem {
  generation: string;
  /** Trusted kernel/dispatcher seam: verify held identities, source/artifact/closure and fsync protection before return. */
  registerHeldHelper(hello: Readonly<PrivateHello>): Promise<void>;
  /** Trusted Host fence: revoke new execution and close Native input before force/mandatory cleanup. */
  closeNativeAdmission(): Promise<void>;
  /** Private inherited socket only. Failure must close control, leaving helper/fence to fail-safe cleanup. */
  write(bytes: Uint8Array): Promise<void>;
  now(): number;
}

/** Control policy only; no Session admission or cleanup capability follows from a helper report alone. */
export class PrivateControlSession {
  readonly #system: PrivateControlSystem;
  readonly #generation: string;
  #hello: Readonly<PrivateHello> | undefined;
  #registered = false;
  #startFenced = false;
  #closing = false;
  #rootReaped = false;
  #complete = false;
  #ordinaryAt: number | undefined;
  constructor(system: PrivateControlSystem) {
    this.#system = system;
    this.#generation = privateGeneration(system.generation);
  }
  get nativeIdentity(): Readonly<{ pid: number; startTime: string }> | undefined {
    return this.#registered && this.#hello
      ? { pid: this.#hello.nativePid, startTime: this.#hello.nativeStartTime } : undefined;
  }
  get helperReportedComplete(): boolean { return this.#complete; }
  get forceAvailable(): boolean {
    return this.#ordinaryAt !== undefined && this.#system.now() - this.#ordinaryAt >= 30_000 && !this.#complete;
  }
  /** Prevents a future START submission while preserving registration and cleanup observations. */
  fenceStart(): void { this.#startFenced = true; }
  /** Caller serializes incoming events; asynchronous registration cannot release a concurrently revoked barrier. */
  async accept(event: PrivateEvent): Promise<void> {
    if (event.generation !== this.#generation || this.#complete) throw new PrivateHelperError("CONTROL_SEQUENCE");
    if (event.kind === "hello") {
      if (this.#hello) throw new PrivateHelperError("CONTROL_SEQUENCE");
      this.#hello = Object.freeze({ ...event });
      try { await this.#system.registerHeldHelper(this.#hello); }
      catch (error) { throw helperError("HELPER_REGISTRATION_FAILED", error); }
      this.#registered = true;
      if (!this.#startFenced && !this.#closing) await this.write("START");
      return;
    }
    if (!this.#hello) throw new PrivateHelperError("CONTROL_SEQUENCE");
    if (event.kind === "rootExit") {
      if (this.#rootReaped) throw new PrivateHelperError("CONTROL_SEQUENCE");
      this.#rootReaped = true;
    }
    if (event.kind === "complete") {
      if (!this.#rootReaped) throw new PrivateHelperError("CONTROL_SEQUENCE");
      this.#complete = true;
    }
  }
  /** Ordinary Stop has no automatic TERM/KILL path, even after root exit or the 30-second offer threshold. */
  async ordinaryStop(): Promise<void> {
    if (!this.#registered || this.#closing || this.#complete) throw new PrivateHelperError("CONTROL_SEQUENCE");
    this.#ordinaryAt ??= this.#system.now();
    await this.write("ORDINARY_STOP");
  }
  /** Invoke only for the distinct, authenticated user force confirmation after the 30-second Stop offer. */
  async forceAfterUserConfirmation(): Promise<void> {
    if (!this.forceAvailable || this.#closing) throw new PrivateHelperError("FORCE_NOT_AVAILABLE");
    this.#closing = true;
    await this.closeAdmission();
    await this.write("FORCE");
  }
  /** Revocation/shutdown uses helper's single absolute 30s cooperative + 5s TERM clock. Never kill the helper. */
  async mandatoryCleanup(): Promise<void> {
    if (this.#closing || this.#complete) return;
    this.#closing = true;
    await this.closeAdmission();
    await this.write("MANDATORY");
  }
  private async write(command: PrivateCommand): Promise<void> {
    try { await this.#system.write(encodeControlCommand(command, this.#generation)); }
    catch (error) { throw helperError("CONTROL_WRITE_FAILED", error); }
  }
  private async closeAdmission(): Promise<void> {
    try { await this.#system.closeNativeAdmission(); }
    catch (error) { throw helperError("NATIVE_ADMISSION_CLOSE_FAILED", error); }
  }
}
