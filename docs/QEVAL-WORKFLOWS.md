# Executed checks and read workflows

Open **Agent → Workflows** to combine Records, Market offers and World history into
a saved read workflow. Save the draft, choose **Validate reads**, then **Run workflow**.
Validation executes the actual native reads and pins the definition digest. Runs
read current authorized data; validation does not freeze data or establish its truth.
Editing requires fresh validation. Results show the actual returned data.

These workflows make no model/provider calls and perform no external or domain-write
stages. Saving a definition and its validation are native writes with normal command
receipts/recovery. The validated definition can contain up to eight stages and the
combined result is bounded to 1 MiB, including reserved framing overhead. There are
at most 64 current workflow definitions and 64 evaluation records per account.
Retention/compaction beyond this profile remains open.

Supported stage definitions:

| Action | Input | Actual read |
|---|---|---|
| `quanta.query` | Empty object or omitted | Current authorized workspace records |
| `market.searchOffers` | Empty object or omitted | Actual current native offers in this account |
| `world.timeQuery` | Optional `asKnownAt` integer and existing `mode` | Native commit-time world view; valid-time reconstruction remains unsupported |

Stage IDs must be distinct ASCII identifiers, at most 64 bytes. Unknown fields,
actions, embedded commands, principals and domains are rejected. `validatedByEval`
cannot grant approval. Changing an origin or replaying a legacy approval cannot make
an unvalidated definition executable. Native validation commits the workflow state
and its evaluation record in one database batch. The runtime checks the matching
definition digest and native validation record before each run. Restricted mandates
must permit every stage; resource-scoped mandates are refused for these broad reads
until scoped query stages exist. Tool-call budgets remain enforced for this profile.

**Agent → Checks** runs the retained 20-item QHarness core catalog. Nine bounded native
behavioral probes currently execute, in separate temporary stores containing synthetic
fixtures. Eleven scenarios explicitly remain **not run**. The aggregate is **partial**,
with actual observations/timings and no samples or values for unsupported model,
recovery, privacy, quality or production KPIs. Any failed/error probe fails the suite.
The runnable catalog is fixed native code; request JSON cannot supply results.

Earlier canned evaluation records remain in native history. `qhStatus` marks them
`effectiveStatus: unverified_legacy`; the UI hides their old success counters. They
cannot approve a workflow. An exact retry retains its original record/receipt;
a fresh key is required to run a fresh evaluation.

Native API additions:

```text
qhSaveWorkflow        { key, payload: { workflowId, title, origin, stages }, id?, expected? }
qhValidateWorkflow    { key, workflowId, expected }
qhExecute             { operation: "execute", execution: { strategy: "workflow", interaction: "sync" }, workflowId, mandateId?, budget?: { maxToolCalls } }
qhRunEval             { key, suite: "qharness-core-20" }
```

The normal authenticated `/api/world/v1/commands` journal handles saves, validation
and evaluation. Read-only runs use `/api/world/v1/qh/v1/execute`. A direct validation
route also exists at `/api/world/v1/qh/v1/workflows/:id/validate`. Hosted sessions,
Origin and CSRF apply. Browser input never selects account scope.

Mandate checks now include current Role ancestry, ancestor revocation/expiry,
token/time/currency attenuation and inherited child defaults/expiry. They do not
establish a complete real-model token/wall-time or cumulative spend reservation
ledger. Real inference, arbitrary effectful DAGs, workflow synthesis, crash/provider
qualification, organization sharing and independent release review remain open.

See [delivery evidence](../../research/unified-world/qeval-foundation/REPORT.md) and
the [frozen contract](../../research/unified-world/qeval-foundation/CONTRACT.md).
