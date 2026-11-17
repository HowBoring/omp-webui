/** Candidate public schema validators. Structural validity does not attest durable success or authority. */
import command from "./navigation-command.js";
import preview from "./navigation-preview.js";
import result from "./navigation-result.js";
import type { NavigationPreview, NavigationResult } from "./omp-wire";

// Native accepts envelopes without id; the callback client always supplies one.
export const validNavigationCommand = (value: unknown): boolean => command(value);
export const validNavigationPreview = (value: unknown): value is NavigationPreview => preview(value);
export const validNavigationResult = (value: unknown): value is NavigationResult => result(value);
