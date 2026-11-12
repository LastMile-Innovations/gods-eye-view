# Activity ACK worker recovery

> Large-store continuation, October18: [retained native efficiency changes](../../research/unified-world/database-efficiency/REPORT.md)
> reduce the100,000-record dev replay observation from43.19s to29.17s. This leaves
> only0.83s nominal margin under the unchanged30s per-dispatch budget; the native
> fixture is not an actual large OS workspace or cold-start/production qualification.
> Full replay is still linear. Verified checkpoints, startup admission and robust
> hosted large-store recovery remain open.


October 18, 2026. **Reality Check / IMPLEMENTED_LOCAL / TESTED_LOCAL;
release REVIEW_PENDING.** [Executed report](../../research/unified-world/native-worker-recovery/REPORT.md).

An uncertain Activity acknowledgement automatically retires the native worker,
waits for its process and stdio to close, reopens the same configured store, and
replays the exact admitted ACK command bytes. The native expected revision,
delivery ID and original request key establish its durable receipt. A transport
exit/timeout or native `UNKNOWN_OUTCOME` can trigger this recovery. A poisoned
handle is never treated as an empty or successful read.

The transport admits at most 16 queued requests and preserves its existing
30-second per-dispatch deadline, frame budgets and one-second shutdown escalation.
The initial ACK may have one automatic recovery dispatch, each with that deadline.
A failed recovery remains `UNKNOWN_OUTCOME`. Each later admitted request can make
one further reconciliation attempt; it must resolve the original ACK before its
own command runs. There is no internal unlimited retry loop or new retry key.
A process that cannot close can still hold the close barrier; SIGKILL escalation
is not proof of an overall wall-clock completion bound.

Only `ackChangeInbox` is eligible for automatic effect replay. Other effectful
commands retain their existing explicit receipt/reconciliation workflow. Native
`UNKNOWN_OUTCOME` or `NATIVE_UNAVAILABLE` responses retire their worker as well,
but do not automatically replay those generic commands. Consumer polling remains
manual and does not acquire automatic ACK semantics.

## Status and account ownership

Authenticated GET `/api/world/v1/change-inbox/recovery` returns only
`{state: "idle" | "recovering" | "blocked" | "recovered"}` with `Cache-Control:
no-store`. The route does not wait behind the native queue, so it remains readable
while the worker closes. Account routing is the same trusted session routing as
other workspace routes. No key, original inputs, principal, path, receipt, private
count or native diagnostic appears in this status.

Activity polls this advisory phase while an inbox action is active and reads its
final phase. Polls do not resolve or acknowledge the command. Late status reads
cannot overwrite a newer phase or restore a cleared session. Session cleanup
stops timers; no recovery request or private data is written to browser storage.
The final phase describes the latest worker recovery in the current process.
`recovered` means the original outcome is established, which can include a
explicit native CONFLICT/INVALID refusal; the command result still decides
success. Current permission refusal or a non-receipt reply does not establish
the earlier commit fate and leaves recovery blocked.

All sessions for one hosted account share its single queue and unresolved ACK
barrier. Another account uses its own store, worker and recovery phase. Idle pool
eviction retains blocked/recovering entries so it cannot forget their original
ACK. Such entries count against the existing worker limit; a full pool can refuse
new accounts with `RATE_LIMITED`. A resolved idle entry can be evicted normally.

## Scope and remaining limits

The original pending ACK bytes and recovery phase live in the server process.
A server/host restart or explicit pool shutdown does not persist that barrier.
Native consumer state and committed receipts remain durable, and callers must
retain original request keys for uncertainty across a server restart. A durable
server recovery queue is not implemented by this change. Persistent corruption,
missing files, full disks and failure to open/close remain unavailable outcomes;
recovery never resets or substitutes the canonical store.

No WAL retention/pruning, push/SSE, distributed lease, arbitrary external-effect
replay, storage epoch change, provider activation or production qualification is
included. OIDC identities in the fault tests are fixtures; the native stores and
HTTP/session routing are real local executions.

## Reproduce local checks

Use supported Node and pinned Rust. Build the normal worker with
`npm run workspace:build`. The fault scripts also require a separately retained
worker built with `--features quanta-core/fault-injection`; point
`NEIGHBOR_RECOVERY_IO_BIN` at that test-only executable. Build/copy it before
restoring the ordinary worker build. Never enable fault injection for a release.

```sh
node --test src/workspace/nativeRecovery.test.mjs src/workspace/changeInbox.test.mjs \
  server/workspace/native.test.mjs server/workspace/plugin.test.mjs \
  server/hosted/workspaces.test.mjs
node scripts/qa-neighbor-worker-recovery.mjs
node scripts/qa-neighbor-worker-recovery-browser.mjs
```

The scripts create disposable stores. Test process instrumentation injects faults,
observes exact dispatch bytes, suppresses one real committed reply, and delays a
close notification to make recovery visible; the maintained transport performs
all reopening/replay. Those test delays are not a production latency measurement.
