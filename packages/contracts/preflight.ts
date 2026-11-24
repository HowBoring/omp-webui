import ready from "./generated/ready.js";
import response from "./generated/response.js";
import report from "./generated/report.js";
import negotiated from "./generated/negotiated.js";
import command from "./generated/command.js";
import type { CompatibilityReport, ReadyEvent, RpcResponse, RpcWireCommands } from "./generated/omp-wire.ts";
export type { CompatibilityReport, ReadyEvent, RpcResponse } from "./generated/omp-wire.ts";
export type PreflightCommand = { id: string; type: "get_compatibility" }
  | ({ id: string; type: "negotiate_protocol" } & RpcWireCommands["negotiate_protocol"]["params"]);
/** Narrow validators: strict preflight commands, public envelopes and command-specific results. */
export const validReady = (value: unknown): value is ReadyEvent => ready(value);
export const validResponse = (value: unknown): value is RpcResponse => response(value);
export const validReport = (value: unknown): value is CompatibilityReport => report(value);
export const validNegotiated = (value: unknown): value is RpcWireCommands["negotiate_protocol"]["result"] => negotiated(value);
export const validCommand = (value: unknown): value is PreflightCommand => command(value);
