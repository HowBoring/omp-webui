import { ControlIoError } from "../control-io/errors.ts";
import type { OwnedControlIo, OwnedControlLoad } from "../control-io/index.ts";
import type { InspectedSelection } from "../delivery/coordinator.ts";
import type { PrivateHelperLaunch, PrivateHelperOwner, PrivateHelperOwnerInput } from "./adapter.ts";
import { selectedControlIo, verifyHelperSelection } from "./control-io-selection.ts";
import { PrivateHelperController, type PrivateHelperHandle, type PrivateHelperProcess } from "./controller.ts";
import { PrivateHelperError, helperError } from "./errors.ts";

/** External loading/filesystem/process seam. Controlled implementations never confer production authorization. */
export interface PrivateHelperOwnerSystem {
  load(input: OwnedControlLoad): Promise<OwnedControlIo>;
  verifyLaunch(input: PrivateHelperLaunch, selection: InspectedSelection): Promise<void>;
  spawn(input: PrivateHelperLaunch, selection: InspectedSelection): PrivateHelperProcess;
  closeControl(fd: number): void;
}

// A reused signal cannot identify one owner invocation.
const launchAttempts = new WeakMap<AbortSignal, { refusal?: PrivateHelperError } | null>();

/** Recognize only the original rejection from this owner's pre-spawn guard. */
export function confirmsPreSpawnRefusal(signal: AbortSignal, error: unknown): boolean {
  const refusal = launchAttempts.get(signal)?.refusal;
  return signal.aborted && refusal !== undefined && refusal === error;
}

// Strong retention includes owners whose callers lose their reference, and failed loads without a returned owner.
const retained = new Set<OwnerLifetime>();
interface OwnerLifetime {
  selection: InspectedSelection;
  module?: OwnedControlIo;
  handles: Set<PrivateHelperHandle>;
}
/** Internal composition shared with the explicitly non-authorizing controlled OS test entry. */
export async function openPrivateHelperOwner(
  input: PrivateHelperOwnerInput, system: PrivateHelperOwnerSystem,
): Promise<PrivateHelperOwner> {
  const selection = input.selection;
  if ([...retained].some(owner => owner.selection === selection)) throw new ControlIoError("CONTROL_IO_BUSY");
  const lifetime: OwnerLifetime = { selection, handles: new Set() };
  retained.add(lifetime);
  try {
    lifetime.module = await system.load({ selection: selectedControlIo(selection),
      approval: Object.freeze({ ...input.controlIoApproval }) });
  } catch (error) {
    const retainProtection = error instanceof ControlIoError
      && ["CONTROL_IO_DISPOSAL_UNCERTAIN", "CONTROL_IO_BUSY"].includes(error.code);
    if (!retainProtection) {
      await selection.release().catch(error => { throw helperError("HELPER_SELECTION_UNVERIFIED", error); });
      retained.delete(lifetime);
    }
    throw error;
  }
  return new RetainedOwner(lifetime, lifetime.module, system);
}

class RetainedOwner implements PrivateHelperOwner {
  readonly #lifetime: OwnerLifetime;
  readonly #module: OwnedControlIo;
  readonly #system: PrivateHelperOwnerSystem;
  #pending = 0;
  #closing: Promise<void> | undefined;
  #closed = false;
  constructor(lifetime: OwnerLifetime, module: OwnedControlIo, system: PrivateHelperOwnerSystem) {
    this.#lifetime = lifetime; this.#module = module; this.#system = system;
  }
  async launch(launch: PrivateHelperLaunch, retirement?: AbortSignal): Promise<PrivateHelperHandle> {
    if (retirement) launchAttempts.set(retirement, launchAttempts.has(retirement) ? null : {});
    requireLaunchActive(retirement);
    if (this.#closed || this.#closing) throw new ControlIoError("CONTROL_IO_CLOSED");
    const selection = this.#lifetime.selection;
    this.#pending++;
    try {
      await this.#system.verifyLaunch(launch, selection);
      requireLaunchActive(retirement);
      try { await launch.prepareHelper(launch.generation); }
      catch (error) { throw helperError("HELPER_PREPARE_FAILED", error); }
      requireLaunchActive(retirement);
      await verifyHelperSelection(selection);
      const controller = new PrivateHelperController({
        spawn: () => {
          requireLaunchActive(retirement);
          return this.#system.spawn(launch, selection);
        },
        openControl: fd => this.#module.openControl(fd), closeControl: fd => this.#system.closeControl(fd),
      });
      const handle = controller.launch({ generation: launch.generation, registerHeldHelper: async hello => {
        await verifyHelperSelection(selection);
        await launch.registerHeldHelper(hello); await verifyHelperSelection(selection);
      } });
      this.#lifetime.handles.add(handle);
      return handle;
    } finally { this.#pending--; }
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    if (this.#closed) return Promise.resolve();
    if (this.#pending) return Promise.reject(new ControlIoError("CONTROL_IO_BUSY"));
    // A failed close is sticky: uncertainty retains the module, selection and every actual helper handle.
    this.#closing = this.dispose();
    return this.#closing;
  }
  private async dispose(): Promise<void> {
    await Promise.all([...this.#lifetime.handles].map(handle => handle.completed));
    await this.#module.close();
    await this.#lifetime.selection.release()
      .catch(error => { throw helperError("HELPER_SELECTION_UNVERIFIED", error); });
    this.#closed = true; this.#lifetime.handles.clear(); retained.delete(this.#lifetime);
  }
}

function requireLaunchActive(retirement?: AbortSignal): void {
  if (!retirement?.aborted) return;
  const refusal = new PrivateHelperError("HELPER_LAUNCH_RETIRED");
  const attempt = launchAttempts.get(retirement);
  if (attempt) attempt.refusal = refusal;
  throw refusal;
}
