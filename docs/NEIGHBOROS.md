# NeighborOS workspace

> October 18 worker recovery: [implemented ACK recovery](NATIVE-WORKER-RECOVERY.md) and
> [executed evidence](../../research/unified-world/native-worker-recovery/REPORT.md) add automatic same-store reopening,
> exact original ACK replay and an unresolved-ACK barrier across account sessions.
> Activity shows recovery status; idle pool eviction preserves blocked entries.
> IMPLEMENTED_LOCAL / TESTED_LOCAL, REVIEW_PENDING. Generic effect replay, durable
> server-restart recovery queues, leases and WAL pruning remain open.


**October 18 consumer continuation:** [Activity's manual change inbox](CHANGE-INBOX.md)
now uses a native owner-controlled checkpoint and stable pending page. It requires
explicit refresh-before-ACK and reconciles uncertain ACKs by their original key.
This supplements snapshot polling; browser reload still starts from a fresh
currently authorized view. [Evidence and open production gates](../../research/unified-world/change-consumers/REPORT.md).


## Coherent database synchronization — October 18, 2026

[Runtime/API contract](DATABASE-SYNC.md) and [executed evidence](../../research/unified-world/database-sync/REPORT.md):
NeighborOS reads its five core projections in one serialized native command and
polls visible connected sessions every five seconds. Unchanged responses preserve
the current DOM. Current source policy, strict account-bound comparison cursors,
single-flight coalescing and late-response disposal remain enforced. This is
IMPLEMENTED_LOCAL / TESTED_LOCAL and REVIEW_PENDING; push/SSE, durable subscriber
checkpoints, cross-host synchronization and production qualification remain open.


The master consolidated specification is [NEIGHBOROS_MASTER_SPEC.md](../../NEIGHBOROS_MASTER_SPEC.md), governed by the **Canonical Authority Architecture**:
1. [docs/NEIGHBOROS_PRODUCT_CONSTITUTION.md](../../docs/NEIGHBOROS_PRODUCT_CONSTITUTION.md) (`NBR-DOC-001` — Product Vision, Ownership & Constitutional Boundaries)
2. [docs/NEIGHBOROS_QUANTA_CANONICAL_ARCHITECTURE.md](../../docs/NEIGHBOROS_QUANTA_CANONICAL_ARCHITECTURE.md) (`NBR-DOC-002` — Canonical Quanta v5 Architecture & Protocol Contracts)
3. [docs/NEIGHBOROS_CAPABILITY_REGISTRY.json](../../docs/NEIGHBOROS_CAPABILITY_REGISTRY.json) (`NBR-DOC-003` — Machine-Readable 4-Dimensional Capability & Status Registry)
4. [docs/QHARNESS_CANONICAL_SPECIFICATION.md](../../docs/QHARNESS_CANONICAL_SPECIFICATION.md) (`NBR-DOC-004` — Universal AI Runtime & Execution Kernel)
5. [docs/COMMONS_ECONOMICS_AND_OPPORTUNITIES.md](../../docs/COMMONS_ECONOMICS_AND_OPPORTUNITIES.md) (`NBR-DOC-005` — Public Commons, Commercial Coordination Flywheel & Opportunity Canvas)
6. [docs/PLANETARY_TWIN_AND_OPERATIONAL_ENGINE.md](../../docs/PLANETARY_TWIN_AND_OPERATIONAL_ENGINE.md) (`NBR-DOC-006` — Planetary Digital Twin & Operational Command Engine)
7. [docs/4D_OMNI_SPATIAL_RECONSTRUCTION_AND_TRACKING.md](../../docs/4D_OMNI_SPATIAL_RECONSTRUCTION_AND_TRACKING.md) (`NBR-DOC-007` — 4D Omni-Spatial Reconstruction & Spatiotemporal Tracking Engine)
8. [docs/QUANTA_PHYSICAL_WORLD_INTELLIGENCE_SYSTEM.md](../../docs/QUANTA_PHYSICAL_WORLD_INTELLIGENCE_SYSTEM.md) (`NBR-DOC-008` — Universal Physical World Intelligence System, 6 Planes, 18 Entities & RealityPatch Protocol)
9. [docs/QUANTA_MATHEMATICAL_AND_LOGICAL_ARCHITECTURE.md](../../docs/QUANTA_MATHEMATICAL_AND_LOGICAL_ARCHITECTURE.md) (`NBR-DOC-009` — Universal Mathematical & Logical Architecture, 16 Engines & Invariants Q-MATH-001–020)
10. [docs/QUANTA_REFERENCE_IMPLEMENTATIONS_AND_CODE_EXAMPLES.md](../../docs/QUANTA_REFERENCE_IMPLEMENTATIONS_AND_CODE_EXAMPLES.md) (`NBR-DOC-010` — Production Code Examples across Rust, Python & TypeScript)
11. [docs/QUANTA_DATA_FABRIC_AND_FEATURE_ENGINEERING.md](../../docs/QUANTA_DATA_FABRIC_AND_FEATURE_ENGINEERING.md) (`NBR-DOC-011` — Planetary Data Fabric, Universal Feature Engineering & Invariants INV-DATA-001–020)
12. [docs/QUANTA_LABELOS_GROUND_TRUTH_AND_DATA_INTELLIGENCE.md](../../docs/QUANTA_LABELOS_GROUND_TRUTH_AND_DATA_INTELLIGENCE.md) (`NBR-DOC-012` — Quanta LabelOS, Ground Truth Registry, 4D Spatiotemporal Annotation & Invariants INV-LABEL-001–020)
13. [docs/QUANTA_UNIVERSAL_CAPABILITY_AND_GENERATIVE_APPLICATIONS.md](../../docs/QUANTA_UNIVERSAL_CAPABILITY_AND_GENERATIVE_APPLICATIONS.md) (`NBR-DOC-013` — Universal Capability Engine, Generative Applications (AppForge), Limitless Use Cases & Invariants INV-UNIV-001–020)
14. [docs/NEIGHBOROS_OVERLAPPING_VISIONS_AND_UNIFIED_ECOSYSTEM.md](../../docs/NEIGHBOROS_OVERLAPPING_VISIONS_AND_UNIFIED_ECOSYSTEM.md) (`NBR-DOC-014` — Overlapping Visions, 7-Pillar Ecosystem Synthesis, Multi-Vision Matrix & Invariants INV-ECO-001–020)
15. [docs/HISTORICAL_PRODUCT_AND_INVENTION_REGISTER.md](../../docs/HISTORICAL_PRODUCT_AND_INVENTION_REGISTER.md) (`NBR-DOC-015` — Historical Product & Invention Register, 10-Family Portfolio Reconstruction, 7 Strategic Portfolios & 4-View Epistemic Ontology)

## Hosted product and development profiles — October 17

Hosted access with provider-neutral OIDC is the product target. See the
[hosting and authentication guide](HOSTED.md) for `npm start`, deployment settings,
private per-account storage, boundaries and remaining live acceptance gates.
Sign in through the provider once; valid sessions restore automatically. No pairing
codes are used. The current hosted foundation is locally tested with a signed
fixture provider and remains REVIEW_PENDING, without a live deployment.

Development uses `npm run dev` and connects the trusted loopback owner automatically.
Local development databases are not silently migrated into online accounts.
Historical pairing descriptions in Build 001–004 reports describe those builds.

## Executed checks and read workflows — October 17

Agent now includes **Workflows** and **Checks**. Save a native read definition,
validate its actual reads and run it against current authorized data. Edits require
fresh validation. The core check catalog executes nine local probes and labels
11 scenarios not run; it reports PARTIAL and no fabricated KPIs.
[Controls, API and limits](QEVAL-WORKFLOWS.md).

## Built application profile

The globe hosts a private account desktop (or a trusted-owner development desktop) with **11 first-party applications**: **Records**, **Market**, **Projects**, **Social**, **Agent**, **Board**, **Documents**, **Evidence**, **Activity**, **Desks** and **History**. Save a camera viewpoint, create needs/missions/tasks, publish exact-money marketplace offers, submit proposals, mint revision-pinned commitments, verify outcomes with Quanta evidence, manage projects and BOMs, discuss in neighborhood channels, compile and approve AI agent plans, import UTF-8 text/Markdown, import an actual USGS reference, and inspect original evidence, 6-category World Time history, and `LicenseGate` policies. Records and bytes use the maintained Quanta core/world libraries.

## Desktop foundation — Build 002

Records, Board and Documents open as independent app windows over the existing globe. Use the dock to open or restore them. Drag a titlebar, resize from any edge/corner, minimize with the amber control, close with red, or maximize/restore with green. The tile button cycles left, right and floating placement. Drag a floating titlebar to a desktop edge to snap; restore a snapped/maximized window before dragging it again.

Cmd/Ctrl+K opens application search. Tab to a title, then use arrows to move and Shift+arrows to resize. Ctrl+Alt+M minimizes, Ctrl+Alt+Left/Right cycles open windows and Ctrl+Alt+Space toggles world controls; Escape returns from World view. Browser/OS shortcut reservations still apply; buttons provide the same navigation. Below 1200px, the focused app fills the work area and the dock switches apps.

Only window layout preferences persist in localStorage under `neighbor.desktop.layout.v1`; records and evidence remain native. Corrupt or blocked preferences fall back safely. [Review and checks](../../research/unified-world/build-002/REPORT.md).

## Native lifecycle and citizen evidence — Build 003

The dock includes Evidence, Activity, Desks and History alongside Records, Board and Documents.

- **Evidence:** preserve an actual file (up to 1 MiB), retain SHA-256/BLAKE3 digests and contributor context, explicitly download the exact original, inspect custody, review six dimensions, cite supporting/contradicting artifacts and create private casebooks. Byte integrity never establishes factual truth. The distinct-source count reflects declared source groups after byte/lineage collapse and requires reviewer independence attestation for a corroborated assessment.
- **Activity:** native command receipts and terminal errors, plus explicit recovery of pending work. Reload never auto-resumes an uncertain command. New domain writes stay blocked while pending work needs review; exact recovery uses the saved request and key.
- **Desks:** save, restore, update or delete a named native window arrangement. A desk cannot delete domain records. Up to 32 arrangements; no record payloads or session data in layouts.
- **History:** actual authored record revisions, newest first, plus the Build 005 World Time 6-Category Rewind Inspector and `LicenseGate` Policy Evaluator.

The worker keeps one native database session and its single-writer lock alive. Starting another process on that directory is refused while it is owned. Stop the original process cleanly before maintenance. Accepted commands are journaled privately before effects, then their native receipts or terminal rejection are recorded. [Evidence and limits](../../research/unified-world/build-003/REPORT.md).

## Corrections, text redaction and local dossiers — Build 004

Evidence claim cards offer **Correct evidence claim**; casebooks offer **Edit casebook**. Existing text/citations are prefilled. Save with the current revision; stale edits refuse. **Revision comparison** shows the two latest actual native revisions side by side.

For a `text/plain` artifact, choose **Create redacted text derivative**. Select sensitive text and choose **Redact selected text**, or enter sorted, nonoverlapping UTF-8 byte ranges. Native validation creates a separate child with exact parent digest/revision and transformation parameters. Original bytes remain unchanged.

In a casebook, choose **Approve local dossier**. Select reviewed native text derivatives, optionally select claims, inspect excerpts and rationale, and explicitly attest review. The Dossiers tab provides **Download reviewed dossier** and **Withdraw dossier approval**. Any selected casebook/claim/artifact or ancestor change makes the approval stale. [Current build evidence](../../research/unified-world/build-004/REPORT.md).

## Connected operating loop, Outcome Chain, World Time & LicenseGate — Build 005

Build 005 adds **Market**, **Projects**, **Social**, and **Agent** windows, the **World Context Object Action Surface**, the **6-Transition Outcome Chain**, the **6-Category World Time Rewind Inspector**, and the **`LicenseGate` Policy Evaluator**:

- **Market (`marketplaceApp.js`):** Create offers across 12 categories using exact integer minor units (`ExactMoney`, `INV-MKT-005`), submit versioned `Proposal` quotes, accept terms to mint a revision-pinned **`Commitment`** (`COMMITMENTS` with `effectReceipt`), and transition commitments between unverified **`reported_complete`** and evidence-backed **`verified_complete`** (`verifyCommitmentOutcome`, requiring at least one valid Quanta Evidence/Document/Record QID).
- **Projects (`projectsApp.js`):** Create projects with spatial `Place` anchors, BOM line items (`ExactMoney`), and milestones, and hand off BOM lines directly to Market via `CapabilityBus`.
- **Social (`socialApp.js`):** Neighborhood channels (`general`, `builders-guild`, `mutual-aid`, `market-talk`, `groundwork`) with threads anchored to `Place`, `Project`, or `MarketOffer` QIDs.
- **Agent (`agentApp.js`):** Deterministic Intent-to-Plan compiler (`compileAgentPlan`) that creates draft plans (`Epistemic::Inferred`) and enforces explicit human confirmation of both the **What I Heard** scope gate and the **Financial** gate (`INV-MKT-008`) before executing (`executeAgentPlan`) into canonical Projects and Tasks.
- **World Context Bar & Window Modes (`worldContextSurface.js`, `capabilityBus.js`):** Every window titlebar can cycle between `Follow World`, `Linked Group A`, and `Independent` context modes. Selecting any object surfaces its native `Role` graph relationships (`/api/world/v1/objects/:id/graph`) and available cross-app capabilities.
- **World Time & `LicenseGate` (`lifecycleViews.js` in History):** Rewind the domain to any `asKnownAt` commit sequence (`GET /api/world/v1/world-time`) across `observedHistory`, `reconstructedHistory`, `asKnownHistory`, `liveObserved`, `forecastModel`, and `scenarioFork` (`validTimeSupported: false`), and evaluate source rights by `(sourceId, operation, derivedOutput)` via `POST /api/world/v1/license-gate`.

## Run

Use Node 24.14+ in the supported 24.x range or Node 26.x, the exact Rust version in `../Quanta/native/rust-toolchain.toml` (currently 1.99.1), and both sibling OS1 checkouts (`gods-eye-view` and `Quanta`).

```sh
npm ci
npm run workspace:build
npm run dev
```

Open the local address printed by Vite. Development connects automatically; no
terminal code is required. Private native records survive server restart. For
hosted access, build the frontend and run `npm start` with the explicit OIDC settings
in [HOSTED.md](HOSTED.md).

```sh
npm run workspace:test
npm test
npm run build
```

Default native build/test now uses the guarded optimized release profile, and the server selects `../Quanta/native/target/release/neighbor-workspace`. Integer overflow checks and debug assertions stay enabled. `node scripts/workspace-native.mjs build --dev` builds development output; selecting that output for serving requires an explicit `NEIGHBOR_NATIVE_BIN`. [Qualification and limits](../../research/unified-world/optimized-worker/REPORT.md).

The native adapter crate lives in `native/workspace`; it uses explicit path dependencies on the sibling native crates and their build cache. `NEIGHBOR_NATIVE_BIN` can select a reviewed binary; `NEIGHBOR_DATA_DIR` can select the local data directory. These are trusted process settings, never browser request parameters.

## Storage and authority

Default storage is the ignored `.neighbor-world/` directory. `identity.json` contains bootstrap domain/owner references; `db/` is native Quanta storage. Preserve both for continuity. Do not delete this folder to resolve a build error.

The HTTP transport checks loopback peer, exact Host/Origin and forwarding signals, then issues an automatic development HttpOnly SameSite session and requires CSRF on non-GET requests. Vite filesystem/static access to the private data directory is denied. The Rust worker is private stdio, accepts validated operations, and cannot take a browser-supplied principal. This development boundary remains separate from the OIDC hosted gateway and its per-account routing. Neither profile establishes independent security certification.

