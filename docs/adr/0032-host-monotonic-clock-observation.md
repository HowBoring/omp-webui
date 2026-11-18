# ADR 0032 — Host monotonic clock observation

- Status — Unregistered source candidate
- Tracks — #29 Decision 15, #44 shutdown and #41 delivery prerequisites

Select a separate, read-only Linux clock ABI for the Host main thread. The C artifact exports
`omp_shutdown_clock_abi` as `uint32_t` and `omp_shutdown_clock_milliseconds` as `uint64_t`.
It samples `CLOCK_MONOTONIC`, floors to integer milliseconds and reserves `UINT64_MAX` for failure.
It checks the returned time fields and the multiply-add range before conversion. The matching lazy
Bun binding reads `u32` and exact `u64` bigint. This addition preserves the socket-byte boundary in ADR 0020
and the separate dispatcher ownership and private/external protector boundaries. [Owned control I/O](0020-owned-control-socket-io.md) · [Delivery prerequisites](0026-unregistered-supervision-prerequisites.md) · [External protector](0027-unregistered-external-protector-composition.md)

The source observer takes a borrowed, already retained `InspectedSelection` and independent ABI 1, binary and C
source digests. Its fixed manifest members are `lib/libomp-shutdown-clock.so` and `provenance/shutdown-clock.c`.
The selected inventory must contain matching regular files and a declared libc member of the platform closure.
The observer verifies the retained selection, hashes the actual bounded descriptors, loads the binary via
its Linux descriptor path, then rechecks the pins, digests and selection before calling the native symbols.
Delivery transfers each opened descriptor to its borrower before the first descriptor, name and ancestry check.
Existing delivery reads close their descriptors when they finish. The observer retains the descriptors and borrowed selection through unloading, with a final
selection check after sampling. An uncertain disposal parks the reservation and refuses subsequent observations
in that lifetime. The caller retains maintenance protection, including on `HOST_MONOTONIC_DISPOSAL_UNCERTAIN`.
The observer neither acquires nor releases that protection.

The production observer requires Linux x64 or arm64, main thread and Bun 1.4.4, and refuses loader override
variables. Controlled tests supply their own runtime predicate.
It requires the fixed `/proc/self/ns/time` and `/proc/self/ns/time_for_children` descriptors to identify the same
nsfs device and inode. It checks that identity before loading and around the sample. Missing or changed
Host clock proof yields a bounded error. The observed Linux environment lacks the two required links.
The runtime version gate and inventory are source checks. Actual loaded Bun, clock library, libc and loader
mappings require separate evidence.

This operation yields one Host-local sample after verification and unload, with no reusable clock binding.
The actual first-Stop deadline later needs a synchronous sample from a retained, approved source at the
original generation fence. It also needs the same time namespace independently verified against the original,
authenticated held helper and an exact private arm/acknowledgement before treating the 30+5 policy as handed
off. The existing direct and owned runtime paths have no dependency on this observer. Controlled tests
exercise Host refusal, pin and lifetime behavior without mapping native code. Syntax-only C checks do not
establish clock or deadline behavior on a real selected installation.
