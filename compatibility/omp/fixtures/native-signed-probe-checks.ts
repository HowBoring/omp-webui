/** Read-only public Native SDK seam; no loader, process, filesystem or transport authority. */
export interface ProbeOwnershipClient {
  listScopes(): Promise<readonly unknown[]>;
  inspectBroker(scope: { kind: "global"; service: "browser-relay" }, generation: string): Promise<unknown>;
  close(): void;
}

/** Each client owns its original transport. A negative request closes that client in the production SDK. */
export async function checkEmptyOwnershipDispatcher(connect: () => ProbeOwnershipClient): Promise<void> {
  async function empty(): Promise<void> {
    const client = connect();
    try {
      if ((await client.listScopes()).length !== 0) throw new Error("PROBE_UNEXPECTED_SCOPE");
    } finally { client.close(); }
  }
  await empty();
  const client = connect();
  try {
    await client.inspectBroker({ kind: "global", service: "browser-relay" }, "0".repeat(64));
    throw new Error("PROBE_INSPECTION_CREATED_OR_GRANTED");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "dispatcher_unavailable") throw error;
  } finally { client.close(); }
  await empty(); // A missing scope inspection must not create a replacement.
}
