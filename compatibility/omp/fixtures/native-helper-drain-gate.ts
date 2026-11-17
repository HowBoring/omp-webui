/** Fixture coordination only. Native's original peer/session and terminal policy supply all Native authority. */
export interface DrainHelperHello {
  readonly generation: string;
  readonly helperPid: number;
  readonly helperStartTime: string;
  readonly nativePid: number;
  readonly nativeStartTime: string;
}
interface DrainHostGateInput {
  readonly generation: string;
  readonly originalHelperPid: () => number | undefined;
  readonly client: {
    prepareHelper(generation: string): Promise<void>;
    helperStatus(generation: string): Promise<"pending" | "registered">;
  };
  readonly registered: (hello: DrainHelperHello) => void;
  readonly continueStart: () => Promise<void>;
}

/** The actual Host controller writes START only after this callback resolves. No dispatcher ACK is synthesized. */
export class HelperDrainHostGate {
  readonly #input: DrainHostGateInput;
  #prepareAttempted = false;
  #prepared = false;
  #registrationAttempted = false;
  constructor(input: DrainHostGateInput) { this.#input = input; }
  async prepareHelper(generation: string): Promise<void> {
    if (this.#prepareAttempted || generation !== this.#input.generation) throw new Error("DRAIN_PREPARE_MISMATCH");
    this.#prepareAttempted = true; // A lost reply retains uncertainty; never retry the original generation.
    await this.#input.client.prepareHelper(generation);
    if (await this.#input.client.helperStatus(generation) !== "pending") throw new Error("DRAIN_PREPARE_NOT_PENDING");
    this.#prepared = true;
  }
  async registerHeldHelper(hello: DrainHelperHello): Promise<void> {
    if (!this.#prepared || this.#registrationAttempted || hello.generation !== this.#input.generation
      || hello.helperPid !== this.#input.originalHelperPid() || hello.nativePid === hello.helperPid
      || !Number.isSafeInteger(hello.nativePid) || hello.nativePid <= 0
      || !/^[1-9]\d*$/.test(hello.helperStartTime) || !/^[1-9]\d*$/.test(hello.nativeStartTime)) {
      throw new Error("DRAIN_HELLO_MISMATCH");
    }
    this.#registrationAttempted = true; // One pending or uncertain status owns the original parent gate.
    if (await this.#input.client.helperStatus(hello.generation) !== "registered") {
      throw new Error("DRAIN_HELPER_NOT_REGISTERED");
    }
    this.#input.registered(Object.freeze({ ...hello }));
    await this.#input.continueStart();
  }
}
