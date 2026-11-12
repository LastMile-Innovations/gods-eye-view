# Activity database change inbox

October 18, 2026. **Reality Check / IMPLEMENTED_LOCAL / TESTED_LOCAL;
release REVIEW_PENDING.** [Executed report](../../research/unified-world/change-consumers/REPORT.md).

Open **Apps → Activity**. **Read a bounded change batch** creates the account's
native consumer if needed and persists one delivery. The checkpoint stays put.
Reload restores the same pending delivery from Quanta. **Refresh and acknowledge
batch** first completes an authorized workspace refresh, then acknowledges that
exact native delivery and revision. This records receipt of a database batch; it
never verifies physical work, payment or an external outcome. It does not certify
that every native predicate was materialized by the desktop.

The existing desktop [snapshot synchronization](DATABASE-SYNC.md) remains separate:
a browser always starts with a fresh currently authorized projection, even if a
native consumer checkpoint exists. Nothing private is restored from a checkpoint
or browser storage. Consumer control is manual; periodic desktop polling does not
create or automatically acknowledge consumers.

## API

All routes use existing account routing and session/origin/CSRF protections; no
body field chooses the principal, store or consumer. POST responses are no-store.

| Route | Request | Native operation |
|---|---|---|
| GET `/api/world/v1/change-inbox/recovery` | no body | Account-local recovery phase, no native queue dispatch |
| GET `/api/world/v1/change-inbox` | no body | `changeInbox` |
| POST `/api/world/v1/change-inbox/poll` | `{key}` | `pollChangeInbox` |
| POST `/api/world/v1/change-inbox/ack` | `{key, expected, delivery}` | `ackChangeInbox` |

`expected` is the canonical decimal string of the consumer revision, and delivery
is the exact native pending ID. Unknown fields or wrong types fail. Native parsing
validates QIDs and canonical sequence strings. Status returns registered,
revision, acknowledged, closed and optional pending metadata. Sequence values in
this status are strings. Raw Change notices, object IDs, commands, private source
counts and values are not forwarded. The core still enforces typed owner control;
per-account stores supply the existing authority separation.

These operations use a dedicated typed native path. Adding their preparation and
ACKs to the normal workspace command journal would itself generate application
changes and defeat bookkeeping filtering. The native consumer records and Change
receipts are their durable journal instead. The regular Activity command list
continues to describe regular workspace actions.

## Recovery and concurrency

An uncertain request retains its immutable original key and body in memory.
**Retry inbox action** resends those same inputs. After a committed ACK's reply
is lost, native historical expected-head reconstruction and exact-key resolution
return the same receipt; the checkpoint cannot advance twice. Reload discovers
current pending/acknowledged state natively. No request key or payload is added to
localStorage.

Native I/O failure may poison the running store handle. Activity ACK now has
[automatic worker reopening and exact-key reconciliation](NATIVE-WORKER-RECOVERY.md).
It waits for process/stdio close, retries the original admitted ACK bytes once,
and holds later commands behind unresolved recovery. Persistent failure retains
`UNKNOWN_OUTCOME`; a fresh key cannot bypass it. Generic commands and manual
consumer polling are not automatically replayed. Server restart recovery queues
remain outside this profile; the linked guide records the exact bounds.

A definitive stale/invalid request is cleared and current native state is read
again. Session loss clears private UI/controller state; delayed old-session replies
cannot republish. The browser refuses ACK if its prerequisite projection read did
not finish successfully. Two clients may receive the same pending page; a new
stale ACK conflicts, so this is not an exclusive lease or an exactly-once receiver
protocol. The core has explicit close semantics; close/reopen administration is
not offered in this UI.

A page scans at most 64 raw commits. A page of metadata can require an ACK to reach
later real changes; a complete metadata-only idle tail writes nothing. This is
bounded replay and native acknowledgement, without retention/pruning, background
processing, leases, SSE, external execution or production acceptance.

## Checks

```sh
npm run workspace:test
node --test src/workspace/changeInbox.test.mjs server/workspace/plugin.test.mjs
node scripts/qa-neighbor-consumers.mjs
```

The browser script uses a disposable synthetic store and the actual native worker.
It drops an HTTP response after native ACK commit, verifies exact retry, and keeps
browser results under `research/unified-world/change-consumers/`.
