import type { InspectedSelection } from "../delivery/coordinator.ts";

export interface SelectionClaim {
  readonly token: symbol;
  release(): void;
}

// This claim coordinates exact in-process lease objects. Delivery still owns the maintenance lease.
const claims = new WeakMap<InspectedSelection, symbol>();

export function claimSelection(selection: InspectedSelection): SelectionClaim | undefined {
  if (claims.has(selection)) return;
  const token = Symbol();
  claims.set(selection, token);
  return {
    token,
    release() {
      if (matchesSelectionClaim(selection, token)) claims.delete(selection);
    },
  };
}

export function matchesSelectionClaim(selection: InspectedSelection, token: symbol): boolean {
  return claims.get(selection) === token;
}
