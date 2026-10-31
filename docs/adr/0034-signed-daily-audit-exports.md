# ADR-0034: Signed daily audit exports

- Status: Proposed
- Date: 2026-10-31

## Context

v0.8.0 calls for signed audit exports and later SIEM streaming. Audit snapshots
contain configuration, names, URLs, reasons, and arbitrary metadata; copying those
serializers is not a safe export policy. Identity sequences are not commit order,
and a closed UTC day can still receive commits from older transactions.

## Proposed decision

Use the versioned format and publication protocol in
[the detailed design](../signed-daily-audit-export.md). Ed25519 signs a canonical
manifest; SHA-256 links canonical projected records and consecutive manifests.
Freeze a durable snapshot before object-store work. Publication is a database CAS,
not an exactly-once network operation. Use only the already private built-in blob
store for this increment; separate external destinations fail closed until their
approval and transport policy exists. Never export raw snapshots or metadata.

This proposal is not accepted and does not certify compliance. Streaming remains
out of scope. The implementation status and missing integration are explicit in
the design; this ADR does not assert a completed product feature.

## Consequences

Frozen facts consume additional database space. Hard record, byte and duration limits fail closed. The snapshot authenticates
only visible projected facts, not every original field nor pre-approval retention losses. Late commits are carried forward within the declared coverage range. Operators
must retain exports and trusted public-key fingerprints outside this system to
detect rollback or deletion of the newest exports. Scheduling is gated by explicit revised settings approval; API, UI and job integration require independent owner acceptance.
