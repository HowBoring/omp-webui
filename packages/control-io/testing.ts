/** Non-authorizing external OS/loading seams for controlled tests; excluded from the published public entry. */
export { createOwnedControlIo, type ControlIoSystem, type ControlScheduler, type IoResult } from "./socket.ts";
export { createOwnedControlIoLoader, type ControlIoLoadingSystem,
  type ControlIoNativeLibrary, type PinnedControlMember } from "./loader.ts";
