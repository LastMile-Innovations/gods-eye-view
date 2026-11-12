# Native database and desktop synchronization

**October 18 consumer continuation:** [Activity's manual change inbox](CHANGE-INBOX.md)
now uses a native owner-controlled checkpoint and stable pending page. It requires
explicit refresh-before-ACK and reconciles uncertain ACKs by their original key.
This supplements snapshot polling; browser reload still starts from a fresh
currently authorized view. [Evidence and open production gates](../../research/unified-world/change-consumers/REPORT.md).


October 18, 2026. **Reality Check: IMPLEMENTED_LOCAL / TESTED_LOCAL; release REVIEW_PENDING.**
The broader synchronization design is Current Design / DESIGNED_SPEC. This profile
has no production validation. [Evidence and source inventory](../../research/unified-world/database-sync/REPORT.md).

## Observable behavior

NeighborOS reads Records, Activity operations, named Desks, Evidence and the domain
network in one native command. A second session using the same account store can
save a task and the visible desktop discovers it without a page reload. Changed
views retain the existing draft-field/focus preservation lifecycle. Unchanged
views retain the actual DOM nodes and selections.

The browser checks every five seconds while visible, connected and not committing
or preparing an action. Hidden tabs stop periodic reads; foreground and local
commands also request synchronization. Browser throttling, native queueing and
errors can delay visibility: five seconds is an interval, not a latency guarantee.
Only one sync request runs at a time; refreshes arriving during that request queue
one follow-up so a concurrent commit cannot be hidden by the earlier read.

## HTTP and native contracts

`POST /api/world/v1/sync` accepts `{}` or `{"cursor":{"version":1,
"workspace":"<canonical QID>","sequence":"<unsigned decimal>"}}`. The decimal
string preserves the native u64 cursor. The legacy projection carries numeric
sequences, so the browser refuses values outside JavaScript's safe-integer range.
Unknown outer/native cursor fields and malformed cursors return INVALID. A cursor
is a comparison hint, never a principal, permission, subscription or command key.
Authentication, origin and CSRF checks run before native access. Responses use
`Cache-Control: no-store`; no shared/browser persistent response cache is added.

The native `sync` operation returns `{changed, reset, cursor, projection?}`.

- `changed:false`: same current authorized domain sequence; no projection payload.
- `changed:true`: `projection` contains `snapshot`, `operations`, `desks`,
  `evidenceNetwork` and `domainNetwork` at one serialized native command boundary.
- Initial, foreign-account, future or unsupported-version cursors reset to a full
  currently authorized view. Ordinary updates also return a full projection.
- At most 64 native change notices are examined. A truncated inventory, authority
  mutation or notice-object overflow requests a full reset. It never implies a
  complete delta or drops the newer state.
- The composed native response is bounded to 8 MiB; over-limit returns
  RESOURCE_LIMIT. Existing collection/query/resource limits remain in force.

The worker executes synchronously and owns the native single-writer lock. It
checks the sequence before and after composing the five projections. This proves
coherence within that process; it does not create a distributed read transaction.
Draft recovery and optional Agent reads remain separate operations with their own
revision checks. Individual old read routes remain available for their consumers.

## Authority, recovery and disposal

Every read revalidates native domain authority. Full projections re-run source
policy checks; raw Change commands, values, request keys and hidden-source object
inventories are never sent through this route. There is no cross-account or
cross-source cache. Source-policy withdrawal changes native sequence and removes
the denied projection on the next successful read.

The client validates bundle structure, account identity, cursor and sequence
agreement before replacing its current projection. Logout/disposal resets the
in-memory cursor, aborts reads, clears private state and rejects delayed responses
from the old generation. Failed reads retain an explicit unavailable state and
clear the comparison cursor so the next read requests a full native view. This
also permits recovery after restoring an older store; a regressed response is
first refused and the next request starts without its old cursor. Whole-session
401/403/404 failures clear the private desktop. Unavailable is never empty.

No cursor is stored in localStorage, a second database or a durable consumer slot.
Reload rebuilds from native state. This is snapshot polling, with replayable native
notice infrastructure; SSE, durable subscriptions/checkpoints, WAL retention,
exactly-once delivery, cross-host sync and production acceptance remain open.

## Running the checks

Use the supported Node version and pinned sibling Rust compiler:

```sh
npm run workspace:test
node --test src/workspace/workspaceSync.test.mjs server/workspace/plugin.test.mjs
node scripts/qa-neighbor-sync.mjs
```

The browser check creates and removes its own synthetic store and records evidence
under `research/unified-world/database-sync/`. No user data or provider activation
is needed. [Quanta notice profile](../../Quanta/docs/specs/34-native-change-notices-v1.md)
defines the maintained Rust read API.
