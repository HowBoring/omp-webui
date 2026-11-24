export type ControlIoErrorCode =
  | "CONTROL_IO_UNSUPPORTED" | "CONTROL_IO_UNAPPROVED" | "CONTROL_IO_SELECTION_CHANGED"
  | "CONTROL_IO_DISPOSAL_UNCERTAIN" | "CONTROL_IO_LOAD_FAILED" | "CONTROL_IO_ABI" | "CONTROL_IO_ADOPT_FAILED" | "CONTROL_IO_HANDLE"
  | "CONTROL_IO_ARGUMENT" | "CONTROL_IO_LIMIT" | "CONTROL_IO_READ_FAILED" | "CONTROL_IO_WRITE_FAILED"
  | "CONTROL_IO_CLOSED" | "CONTROL_IO_CLOSE_UNCERTAIN" | "CONTROL_IO_BUSY" | "CONTROL_IO_CALLBACK_FAILED";

/** No path, payload, raw exception or unbounded OS message crosses this seam. Close errors prove no extinction. */
export class ControlIoError extends Error {
  readonly errno: number;
  constructor(readonly code: ControlIoErrorCode, errno = 0) {
    super(code);
    this.name = "ControlIoError";
    this.errno = Number.isInteger(errno) && errno > 0 && errno <= 4095 ? errno : 0;
  }
}
