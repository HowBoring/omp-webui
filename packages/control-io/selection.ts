/** Complete selected inventory, including directory membership, links, modes and outside platform dependencies. */
export interface ControlReleaseMember {
  readonly path: string;
  readonly kind: "file" | "directory" | "link";
  readonly identity: string;
  readonly mode: number;
}
export interface ControlReleaseManifest {
  readonly format: "omp-webui-release-inventory-v1";
  readonly stage: "unaccepted-artifact";
  readonly platform: string;
  readonly arch: string;
  readonly assets: readonly ControlReleaseMember[];
  readonly platformDependencies: readonly ControlReleaseMember[];
}
/**
 * Caller-selected immutable release under an independently acquired maintenance use lease.
 * identity is the independently authenticated exhaustive manifest identity, never a checksum enrolled by the loader.
 * verify must recheck the lease before/after the entire exhaustive inventory, manifest identity and platform closure.
 * Retain the selection and its protection through all sockets, callbacks and awaited module disposal. Never release
 * on uncertain socket/library disposal, including CONTROL_IO_DISPOSAL_UNCERTAIN from a load returning no module.
 * A pathname/digest pair or self-generated approval cannot satisfy this contract. The loader acquires no lease.
 */
export interface ControlIoSelection {
  readonly selected: { readonly release: {
    readonly root: string;
    readonly identity: string;
    readonly manifest: ControlReleaseManifest;
  } };
  verify(): Promise<void>;
  release(): Promise<void>;
}
