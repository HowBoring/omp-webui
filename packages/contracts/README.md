# Contracts

This package will contain explicit, versioned adapter contracts for:

- OMP RPC commands, responses, server frames, and protocol-v2 chunk framing.
- DSH Connection envelopes and Typert Remote methods.
- DSH Session event, projection, snapshot, and stream frame types.
- Host-internal worker, Session Registry, and Interaction Broker interfaces.

Contract provenance must be recorded with the exact upstream commit and source path. Prefer generated types from upstream schemas where available. Do not hand-maintain a second, drifting copy of a large upstream union.

No OMP Agent SDK or DSH Host runtime types should leak into the Host's domain interfaces.
