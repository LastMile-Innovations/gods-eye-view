# Documentation map

Current database/OS execution: [bounded recovery](../../Quanta/docs/specs/40-bounded-canonical-replay.md) · [optimized worker profile](../../Quanta/docs/specs/41-qualified-optimized-worker.md) · [integrated evidence and open gates](../../research/unified-world/optimized-worker/REPORT.md).

Current database performance: [native scope and frozen measurements](../../Quanta/docs/specs/37-operation-scoped-index-reads.md) · [end-to-end evidence and open gates](../../research/unified-world/database-efficiency/REPORT.md).

Current native world-data capacity: [index buffer and verified limits](../../Quanta/docs/specs/36-bounded-index-write-buffering.md) · [local evidence](../../research/unified-world/world-scale/REPORT.md).

Current Activity ACK worker recovery: [NATIVE-WORKER-RECOVERY.md](NATIVE-WORKER-RECOVERY.md) · [local evidence](../../research/unified-world/native-worker-recovery/REPORT.md).

Current manual native change inbox: [CHANGE-INBOX.md](CHANGE-INBOX.md) · [local evidence](../../research/unified-world/change-consumers/REPORT.md).

Current database/desktop synchronization: [DATABASE-SYNC.md](DATABASE-SYNC.md) · [local evidence](../../research/unified-world/database-sync/REPORT.md).

Native evaluation and Agent read workflows: [QEVAL-WORKFLOWS.md](QEVAL-WORKFLOWS.md).

Current hosted entry point and deployment instructions: [HOSTED.md](HOSTED.md).
Hosted users sign in through OIDC; development connects automatically with no codes.

LastMile Innovations fork · October 16, 2026

**Existing application contracts and proposed unified-product architecture are separate evidence classes.** Start with [fork instructions](../AGENTS.md) and [integration guide](UNIFIED-WORLD.md). The unified product now has a bounded [native-backed local workspace](NEIGHBOROS.md). The full vision remains proposed; use the [canonical master specification](../../NEIGHBOROS_MASTER_SPEC.md) and [build evidence](../../research/unified-world/build-001/REPORT.md) for current authority and verification.

Current desktop UX: [application design](DESKTOP-APPLICATION-DESIGN.md) · [local evidence](../../research/unified-world/desktop-foundation/REPORT.md).

## Choose the task

| Task | Start here |
|---|---|
| Run the current application | [README](../README.md), [contributor setup](../CONTRIBUTING.md) |
| Understand runtime behavior | [Current state](CURRENT-STATE.md), [known issues](KNOWN-ISSUES.md) |
| Compose/refactor components | [Application](APPLICATION.md), [boundaries](CODE-BOUNDARIES.md), [UI](UI-OWNERSHIP.md), [voice](VOICE-OWNERSHIP.md) |
| Design OS/Quanta integration | [Unified guide](UNIFIED-WORLD.md), [Canonical Authority Architecture](../../NEIGHBOROS_MASTER_SPEC.md), [sibling research package](../../research/unified-world/README.md) |
| Verify changes | [Testing](../TESTING.md), [contributing](../CONTRIBUTING.md), [published performance](PERFORMANCE.md) |
| Review rights/security | [Data sources](../DATA_SOURCES.md), [model notices](../public/models/README.md), [software notices](../THIRD_PARTY_NOTICES.md), [security](../SECURITY.md) |
| Integrate contributions | [Fork instructions](../AGENTS.md), [maintainer workflow](MAINTAINER_WORKFLOW.md) |

The sibling research package is an OS1 workspace artifact; standalone clones need it packaged separately. Published performance, translated guides, media, changelog history and third-party/source notices retain their original evidence scope. Source instructions take precedence over marketing summaries; a plan is not implementation.

## Complete Markdown inventory

Every existing Markdown file is indexed below. Runtime guides receive shared navigation; source/legal attribution, translations and historical records retain their content. [Disposition register](../../research/unified-world/DOCUMENTATION_DISPOSITION.csv) records the decision for each file.

| Document | Disposition | Purpose |
|---|---|---|
| [docs/NATIVE-WORKER-RECOVERY.md](NATIVE-WORKER-RECOVERY.md) | NEW | Bounded automatic ACK reconciliation, status, account isolation and limits |
| [docs/CHANGE-INBOX.md](CHANGE-INBOX.md) | NEW | Manual durable native consumer, recovery, API and limits |
| [docs/DATABASE-SYNC.md](DATABASE-SYNC.md) | NEW | Current native notice, coherent sync, cursor, polling and recovery profile |
| [.agents/skills/community-pr/SKILL.md](../.agents/skills/community-pr/SKILL.md) | INDEXED | existing specialized security/testing/media/tool/fixture guidance retained |
| [AGENTS.md](../AGENTS.md) | NEW | fork instructions / documentation routing / integration boundary |
| [CHANGELOG.md](../CHANGELOG.md) | PRESERVED | historical record / changelog assembly policy |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | REFACTORED | fork entry point / reproducible install / fork versus upstream authority |
| [DATA_SOURCES.md](../DATA_SOURCES.md) | PRESERVED | source/data/model attribution and licence evidence; indexed without rewriting |
| [README.md](../README.md) | REFACTORED | fork entry point / reproducible install / fork versus upstream authority |
| [SECURITY.md](../SECURITY.md) | INDEXED | existing specialized security/testing/media/tool/fixture guidance retained |
| [TESTING.md](../TESTING.md) | INDEXED | existing specialized security/testing/media/tool/fixture guidance retained |
| [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) | PRESERVED | source/data/model attribution and licence evidence; indexed without rewriting |
| [changelog.d/787-changelog-fragments.md](../changelog.d/787-changelog-fragments.md) | PRESERVED | historical record / changelog assembly policy |
| [changelog.d/README.md](../changelog.d/README.md) | PRESERVED | historical record / changelog assembly policy |
| [docs/APPLICATION.md](APPLICATION.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/CODE-BOUNDARIES.md](CODE-BOUNDARIES.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/CURRENT-STATE.md](CURRENT-STATE.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/DESKTOP-APPLICATION-DESIGN.md](DESKTOP-APPLICATION-DESIGN.md) | NEW | application design for multi-window desktop shell and native persistence |
| [docs/DIRECTOR-CAMERA.md](DIRECTOR-CAMERA.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/DIRECTOR-DATA-PACKS.md](DIRECTOR-DATA-PACKS.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/DIRECTOR-INTERACTIONS.md](DIRECTOR-INTERACTIONS.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/DIRECTOR-SHARING.md](DIRECTOR-SHARING.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/DIRECTOR.md](DIRECTOR.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/HOSTED.md](HOSTED.md) | NEW | hosted entry point, provider-neutral OIDC and deployment instructions |
| [docs/I18N.md](I18N.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/INFRASTRUCTURE-LAYERS.md](INFRASTRUCTURE-LAYERS.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/KNOWN-ISSUES.md](KNOWN-ISSUES.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/LOCAL-RECEIVERS.md](LOCAL-RECEIVERS.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/MAINTAINER_WORKFLOW.md](MAINTAINER_WORKFLOW.md) | REFACTORED | fork entry point / reproducible install / fork versus upstream authority |
| [docs/MCP_SETUP.md](MCP_SETUP.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/NBR-MARKET-001.md](NBR-MARKET-001.md) | NEW | marketplace protocol, offer schemas, and exact-money contracts |
| [docs/NEIGHBOROS.md](NEIGHBOROS.md) | NEW | fork instructions / documentation routing / integration boundary |
| [docs/PERFORMANCE.md](PERFORMANCE.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/PR_REVIEW_SANDBOX.md](PR_REVIEW_SANDBOX.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/QEVAL-WORKFLOWS.md](QEVAL-WORKFLOWS.md) | NEW | native evaluation suite, read workflows, and executed probe controls |
| [docs/README.md](README.md) | NEW | fork instructions / documentation routing / integration boundary |
| [docs/SCENE-DOCUMENT.md](SCENE-DOCUMENT.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/TOOLS.md](TOOLS.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/TRANSLATORS.md](TRANSLATORS.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/UI-OWNERSHIP.md](UI-OWNERSHIP.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/UNIFIED-WORLD.md](UNIFIED-WORLD.md) | NEW | fork instructions / documentation routing / integration boundary |
| [docs/VOICE-OWNERSHIP.md](VOICE-OWNERSHIP.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/media/README.md](media/README.md) | INDEXED | existing specialized security/testing/media/tool/fixture guidance retained |
| [docs/opensky-auth.md](opensky-auth.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/panel-surfaces.md](panel-surfaces.md) | REFACTORED | shared navigation; existing runtime contract and historical content preserved |
| [docs/translations/es.md](translations/es.md) | PRESERVED | translated upstream reference; index marks fork proposal separately |
| [docs/translations/ru.md](translations/ru.md) | PRESERVED | translated upstream reference; index marks fork proposal separately |
| [public/events/bhote-koshi-2026/README.md](../public/events/bhote-koshi-2026/README.md) | PRESERVED | source/data/model attribution and licence evidence; indexed without rewriting |
| [public/models/README.md](../public/models/README.md) | PRESERVED | source/data/model attribution and licence evidence; indexed without rewriting |
| [scripts/fixtures/voice/README.md](../scripts/fixtures/voice/README.md) | INDEXED | existing specialized security/testing/media/tool/fixture guidance retained |
| [src/data/fixtures/README.md](../src/data/fixtures/README.md) | PRESERVED | source/data/model attribution and licence evidence; indexed without rewriting |
| [src/data/local_data/cctv_ground_heights/README.md](../src/data/local_data/cctv_ground_heights/README.md) | PRESERVED | source/data/model attribution and licence evidence; indexed without rewriting |
| [src/data/local_data/dams/README.md](../src/data/local_data/dams/README.md) | PRESERVED | source/data/model attribution and licence evidence; indexed without rewriting |
| [src/data/local_data/datacenters/README.md](../src/data/local_data/datacenters/README.md) | PRESERVED | source/data/model attribution and licence evidence; indexed without rewriting |
| [src/data/local_data/natural_earth/README.md](../src/data/local_data/natural_earth/README.md) | PRESERVED | source/data/model attribution and licence evidence; indexed without rewriting |
| [src/data/local_data/neighborhoods/SOURCE.md](../src/data/local_data/neighborhoods/SOURCE.md) | PRESERVED | source/data/model attribution and licence evidence; indexed without rewriting |
| [src/data/local_data/osm_military_names/README.md](../src/data/local_data/osm_military_names/README.md) | PRESERVED | source/data/model attribution and licence evidence; indexed without rewriting |
| [src/data/local_data/telegeography_submarine_cables/README.md](../src/data/local_data/telegeography_submarine_cables/README.md) | PRESERVED | source/data/model attribution and licence evidence; indexed without rewriting |
| [src/data/local_data/us_census_counties/README.md](../src/data/local_data/us_census_counties/README.md) | PRESERVED | source/data/model attribution and licence evidence; indexed without rewriting |
| [tools/README.md](../tools/README.md) | INDEXED | existing specialized security/testing/media/tool/fixture guidance retained |
