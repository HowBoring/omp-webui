/** Public main-thread entry. Importing this module performs no FFI import, library load or I/O. */
export { ControlIoError, type ControlIoErrorCode } from "./errors.ts";
export { loadOwnedControlIo, type OwnedControlApproval, type OwnedControlLoad } from "./loader.ts";
export type { ControlIoSelection, ControlReleaseManifest, ControlReleaseMember } from "./selection.ts";
export type { ControlSocket, OwnedControlIo, OwnedControlSocket } from "./socket.ts";
