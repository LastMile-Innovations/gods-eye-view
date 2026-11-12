import { t } from '../i18n/index.js';
/**
 * @typedef {Object} NeighborAppManifest
 * @property {'records'|'marketplace'|'projects'|'social'|'agent'|'board'|'documents'|'recovery'|'desks'|'history'|'evidence'} appId
 * @property {string} name
 * @property {string} glyph
 * @property {'globe'|'marketplace'|'projects'|'social'|'agent'|'board'|'documents'|'recovery'|'desks'|'history'|'evidence'} view
 * @property {[number, number]} defaultSize
 * @property {readonly string[]} commands
 *
 * First-party presentation registry. Registration never grants domain authority.
 * Commands resolve to data, not executable strings supplied by a manifest.
 */
/** @type {readonly NeighborAppManifest[]} */
export const NEIGHBOR_APPS = Object.freeze(
  [
    {
      appId: 'records',
      name: 'Records',
      glyph: '◈',
      view: 'globe',
      defaultSize: [620, 580],
      commands: ['app.records.open'],
    },
    {
      appId: 'marketplace',
      name: 'Market',
      glyph: '⬡',
      view: 'marketplace',
      defaultSize: [940, 640],
      commands: ['app.marketplace.open'],
    },
    {
      appId: 'projects',
      name: 'Projects',
      glyph: '◫',
      view: 'projects',
      defaultSize: [960, 650],
      commands: ['app.projects.open'],
    },
    {
      appId: 'social',
      name: 'Social',
      glyph: '◎',
      view: 'social',
      defaultSize: [860, 620],
      commands: ['app.social.open'],
    },
    {
      appId: 'agent',
      name: 'Agent',
      glyph: '✦',
      view: 'agent',
      defaultSize: [880, 640],
      commands: ['app.agent.open'],
    },
    {
      appId: 'board',
      name: 'Board',
      glyph: '▦',
      view: 'board',
      defaultSize: [900, 610],
      commands: ['app.board.open'],
    },
    {
      appId: 'documents',
      name: 'Documents',
      glyph: '▤',
      view: 'documents',
      defaultSize: [760, 580],
      commands: ['app.documents.open'],
    },
    {
      appId: 'evidence',
      name: 'Evidence',
      glyph: '◇',
      view: 'evidence',
      defaultSize: [1000, 650],
      commands: ['app.evidence.open'],
    },
    {
      appId: 'recovery',
      name: 'Activity',
      glyph: '↻',
      view: 'recovery',
      defaultSize: [760, 580],
      commands: ['app.recovery.open'],
    },
    {
      appId: 'desks',
      name: 'Desks',
      glyph: '▧',
      view: 'desks',
      defaultSize: [640, 520],
      commands: ['app.desks.open'],
    },
    {
      appId: 'history',
      name: 'History',
      glyph: '◷',
      view: 'history',
      defaultSize: [760, 580],
      commands: ['app.history.open'],
    },
  ].map((app) =>
    Object.freeze({
      ...app,
      defaultSize: Object.freeze(app.defaultSize),
      commands: Object.freeze(app.commands),
    }),
  ),
);

export function resolveCommand(commandId) {
  const app = NEIGHBOR_APPS.find((app) => app.commands.includes(commandId));
  return app ? { type: 'open', appId: app.appId } : undefined;
}

/**
 * Canonical 4-dimensional capability status registry (`NBR-BUILD-005`).
 * Keeps Specification, Implementation, Verification, and Release status orthogonal.
 */
export const NEIGHBOR_CAPABILITY_REGISTRY = Object.freeze([
  {
    id: 'CAP-QUANTA-HYBRID-RECORDS',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Hybrid Native Quanta Domain Records & Role Graph',
    domain: 'quanta-core / neighbor-workspace',
    nativeOps: ['snapshot', 'domainNetwork', 'objectGraph'],
    acceptedKinds: [
      'place',
      'need',
      'mission',
      'task',
      'document',
      'reference',
      'market-offer',
      'proposal',
      'commitment',
      'project',
      'social-post',
    ],
    specificationStatus: 'approved',
    implementationStatus: 'implemented',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'native/workspace/tests/domain_network.rs',
  },
  {
    id: 'CAP-INTENT-TO-OBJECT',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Intent -> Object Deterministic Plan Compiler & Consent Gates',
    domain: 'agent',
    appId: 'agent',
    nativeOps: ['compileAgentPlan', 'executeAgentPlan'],
    acceptedKinds: ['place', 'need', 'mission', 'project', 'market-offer'],
    specificationStatus: 'approved',
    implementationStatus: 'implemented',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'native/workspace/tests/domain_network.rs',
  },
  {
    id: 'CAP-UNIVERSAL-PRODUCT-GRAPH',
    title:
      // i18n-ignore: canonical specification metadata, not a product label
      'Universal Product Graph (QUPG), Multi-Merchant Offer Network & Landed Cost Engine',
    domain: 'marketplace / commerce',
    appId: 'marketplace',
    nativeOps: [
      'searchProductGraph',
      'quoteLandedCost',
      'executeCheckout',
      'executeCartCheckout',
    ],
    acceptedKinds: ['market-product', 'market-offer', 'project', 'need'],
    specificationStatus: 'approved',
    implementationStatus: 'implemented',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'src/workspace/marketCatalog.js',
  },
  {
    id: 'CAP-MARKET-PROPOSAL',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Capability -> Proposal ExactMoney Sourcing & Quotes',
    domain: 'marketplace',
    appId: 'marketplace',
    nativeOps: ['saveMarketOffer', 'saveProposal', 'seedStarterCatalog'],
    acceptedKinds: ['market-offer', 'project', 'place', 'need'],
    specificationStatus: 'approved',
    implementationStatus: 'implemented',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'native/workspace/tests/domain_network.rs',
  },
  {
    id: 'CAP-PROPOSAL-TO-COMMITMENT',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Proposal -> Commitment -> Verified Outcome Lifecycle',
    domain: 'marketplace / projects',
    appId: 'marketplace',
    nativeOps: ['saveCommitment', 'verifyCommitmentOutcome'],
    acceptedKinds: ['proposal', 'commitment', 'project'],
    specificationStatus: 'approved',
    implementationStatus: 'implemented',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'native/workspace/tests/domain_network.rs',
  },
  {
    id: 'CAP-PROJECT-PIPELINE',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Projects 6-Stage Pipeline, Milestones & BOM Handoff',
    domain: 'projects',
    appId: 'projects',
    nativeOps: ['saveProject'],
    acceptedKinds: [
      'project',
      'place',
      'need',
      'mission',
      'task',
      'market-offer',
    ],
    specificationStatus: 'approved',
    implementationStatus: 'implemented',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'native/workspace/tests/domain_network.rs',
  },
  {
    id: 'CAP-SOCIAL-SHARED-CARDS',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Social Channels, Threads & Shared Object Cards',
    domain: 'social',
    appId: 'social',
    nativeOps: ['saveSocialPost'],
    acceptedKinds: [
      'project',
      'market-offer',
      'place',
      'need',
      'mission',
      'document',
      'commitment',
    ],
    specificationStatus: 'approved',
    implementationStatus: 'implemented',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'native/workspace/tests/domain_network.rs',
  },
  {
    id: 'CAP-CITIZEN-EVIDENCE-DOSSIER',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Citizen Evidence Preservation, UTF-8 Redaction & Scoped Dossiers',
    domain: 'evidence',
    appId: 'evidence',
    nativeOps: [
      'preserveEvidence',
      'reviewEvidence',
      'saveEvidenceClaim',
      'saveCasebook',
      'deriveEvidenceText',
      'saveEvidenceDisclosure',
    ],
    acceptedKinds: ['artifact', 'claim', 'casebook', 'commitment', 'project'],
    specificationStatus: 'approved',
    implementationStatus: 'implemented',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'native/workspace/tests/citizen_disclosure.rs',
  },
  {
    id: 'CAP-WORLD-TIME-AS-KNOWN',
    title:
      // i18n-ignore: canonical specification metadata, not a product label
      'World Time As-Known Sequence Rewind & 6-Category Epistemic Partition',
    domain: 'world-time',
    appId: 'history',
    nativeOps: ['worldTimeQuery', 'history', 'citizenHistory'],
    acceptedKinds: [
      'place',
      'need',
      'mission',
      'task',
      'project',
      'market-offer',
      'proposal',
      'commitment',
      'artifact',
    ],
    specificationStatus: 'approved',
    implementationStatus: 'implemented',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'native/workspace/tests/domain_network.rs',
  },
  {
    id: 'CAP-LICENSE-GATE',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Deterministic Source-and-Operation LicenseGate Policy Evaluator',
    domain: 'quanta-world / license-gate',
    nativeOps: ['evaluateLicenseGate'],
    acceptedKinds: ['reference', 'document', 'place', 'artifact'],
    specificationStatus: 'approved',
    implementationStatus: 'implemented',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'native/workspace/tests/domain_network.rs',
  },
  {
    id: 'CAP-PLANETARY-VALID-TIME-INTERPOLATION',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Continuous Event-Time Interpolation & 100k Orbital Propagation',
    domain: 'world-engine',
    nativeOps: [],
    acceptedKinds: [],
    specificationStatus: 'reviewed',
    implementationStatus: 'unbuilt',
    verificationStatus: 'not_tested',
    releaseStatus: 'disabled',
    evidence:
      'Gated behind valid-time schema and hardware benchmark qualification',
  },
  {
    id: 'CAP-UNREAL-WGPU-TRI-ENGINE',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Unreal Engine 5 / Custom wgpu 500k Entity Zero-Copy Instancing',
    domain: 'world-engine',
    nativeOps: [],
    acceptedKinds: [],
    specificationStatus: 'proposed',
    implementationStatus: 'unbuilt',
    verificationStatus: 'not_tested',
    releaseStatus: 'disabled',
    evidence:
      'Optimization hypothesis; requires multi-GPU benchmark qualification',
  },
  {
    id: 'CAP-QH-SERVE-001',
    // i18n-ignore: canonical specification metadata, not a product label
    title:
      'QServe Model Gateway, Constrained Optimization Router & OpenAI-Compatible API', // i18n-ignore: canonical specification metadata
    domain: 'qharness / qserve',
    appId: 'agent',
    nativeOps: [
      'qhModels',
      'qhOpenAiChatCompletions',
      'qhOpenAiResponses',
      'qhOpenAiGetResponse',
      'qhOpenAiCancelResponse',
      'qhOpenAiEmbeddings',
    ],
    acceptedKinds: ['place', 'need', 'mission', 'task', 'project'],
    specificationStatus: 'specified',
    implementationStatus: 'partial',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'native/workspace/tests/qharness_acceptance.rs',
  },
  {
    id: 'CAP-QH-FLOW-001',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'QFlow Deterministic Multi-Step Pipelines & Workflow Promotion Gate',
    domain: 'qharness / qflow',
    appId: 'agent',
    nativeOps: ['qhExecute', 'qhSaveWorkflow'],
    acceptedKinds: ['place', 'need', 'mission', 'task', 'project', 'document'],
    specificationStatus: 'specified',
    implementationStatus: 'partial',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'native/workspace/tests/qharness_acceptance.rs',
  },
  {
    id: 'CAP-QH-AGENT-001',
    // i18n-ignore: canonical specification metadata, not a product label
    title:
      'QAgent Durable Missions, Monotonic Mandates, QFrame & Crash Recovery', // i18n-ignore: canonical specification metadata
    domain: 'qharness / qagent',
    appId: 'agent',
    nativeOps: [
      'qhExecute',
      'qhCreateMandate',
      'qhRevokeMandate',
      'qhCreateMission',
      'qhMissionAction',
      'qhCompileFrame',
      'qhSaveMemory',
      'qhReconcileRun',
    ],
    acceptedKinds: [
      'place',
      'need',
      'mission',
      'task',
      'project',
      'market-offer',
      'proposal',
      'commitment',
    ],
    specificationStatus: 'specified',
    implementationStatus: 'partial',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'native/workspace/tests/qharness_acceptance.rs',
  },
  {
    id: 'CAP-QH-CONTROL-001',
    // i18n-ignore: canonical specification metadata, not a product label
    title:
      'QHarness Control Surface, Capability Descriptors & QH-EVAL-001..020 Runner', // i18n-ignore: canonical specification metadata
    domain: 'qharness / qeval',
    appId: 'agent',
    nativeOps: [
      'qhStatus',
      'qhCapabilities',
      'qhRunEval',
      'qhValidateWorkflow',
    ],
    acceptedKinds: ['mission', 'task', 'project'],
    specificationStatus: 'specified',
    implementationStatus: 'partial',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'native/workspace/tests/qharness_acceptance.rs',
  },
  {
    id: 'CAP-ECO-001',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Everyday Personal Operating System & Client-Side Asymmetric Privacy Vault',
    domain: 'personal-os',
    appId: 'records',
    nativeOps: ['savePlace', 'saveNeed'],
    acceptedKinds: ['place', 'need', 'task', 'tool', 'home-twin'],
    specificationStatus: 'approved',
    implementationStatus: 'implemented',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'docs/NEIGHBOROS_OVERLAPPING_VISIONS_AND_UNIFIED_ECOSYSTEM.md',
  },
  {
    id: 'CAP-ECO-002',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Physical Marketplace & 6-Transition Milestone Escrow Coordination',
    domain: 'marketplace',
    appId: 'marketplace',
    nativeOps: ['saveMarketOffer', 'saveProposal', 'saveCommitment', 'verifyCommitmentOutcome'],
    acceptedKinds: ['market-offer', 'proposal', 'commitment', 'project'],
    specificationStatus: 'approved',
    implementationStatus: 'implemented',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'gods-eye-view/src/workspace/capabilityBus.test.mjs',
  },
  {
    id: 'CAP-ECO-003',
    // i18n-ignore: canonical specification metadata, not a product label
    title: '10-Scale 4D Planetary Digital Twin & Astrodynamic Orbital Propagator',
    domain: 'planetary-twin',
    appId: 'records',
    nativeOps: ['worldTimeQuery'],
    acceptedKinds: ['place', 'physical-asset', 'satellite', 'trajectory'],
    specificationStatus: 'approved',
    implementationStatus: 'implemented',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'docs/PLANETARY_TWIN_AND_OPERATIONAL_ENGINE.md',
  },
  {
    id: 'CAP-ECO-004',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Citizen Intelligence Commons, Public Money X-Ray & Institutional Sousveillance',
    domain: 'citizen-intelligence',
    appId: 'evidence',
    nativeOps: ['preserveEvidence', 'saveEvidenceClaim', 'saveCasebook'],
    acceptedKinds: ['artifact', 'claim', 'casebook', 'public-budget', 'contract-bid'],
    specificationStatus: 'approved',
    implementationStatus: 'implemented',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'research/unified-world/CITIZEN_INTELLIGENCE_COMMONS.md',
  },
  {
    id: 'CAP-ECO-005',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Industrial Machine Telematics, Digital Asset Passports & Sub-Pixel Structural Deflection',
    domain: 'industrial-twin',
    appId: 'projects',
    nativeOps: ['saveProject'],
    acceptedKinds: ['machine', 'sensor-stream', 'asset-pass', 'work-order'],
    specificationStatus: 'approved',
    implementationStatus: 'implemented',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'docs/QUANTA_PHYSICAL_WORLD_INTELLIGENCE_SYSTEM.md',
  },
  {
    id: 'CAP-ECO-006',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Universal Capability Engine, AppForge Declarative UI & WASM Sandboxing',
    domain: 'universal-capability',
    appId: 'agent',
    nativeOps: ['compileAgentPlan', 'executeAgentPlan'],
    acceptedKinds: ['capability', 'workflow-dag', 'quantaview', 'mission'],
    specificationStatus: 'approved',
    implementationStatus: 'implemented',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'docs/QUANTA_UNIVERSAL_CAPABILITY_AND_GENERATIVE_APPLICATIONS.md',
  },
  {
    id: 'CAP-ECO-007',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Sovereign Data Commons, Reference Inversion & F52 Commercial Coordination Flywheel',
    domain: 'commons',
    appId: 'history',
    nativeOps: ['evaluateLicenseGate'],
    acceptedKinds: ['public-dataset', 'qid-ref', 'bounty-pool', 'coordination-fee'],
    specificationStatus: 'approved',
    implementationStatus: 'implemented',
    verificationStatus: 'locally_tested',
    releaseStatus: 'internal',
    evidence: 'docs/COMMONS_ECONOMICS_AND_OPPORTUNITIES.md',
  },
]);

export const NEIGHBOR_SUPERSESSION_REGISTRY = Object.freeze([
  {
    supersededId: 'ARCH-RUST-HTTP-SERVICE-V1',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Standalone Rust HTTP Service & 10 MiB Upload Proposal',
    specificationStatus: 'superseded',
    replacedBy:
      'Node/Vite loopback host + private Rust stdio worker + 1 MiB local original boundary (Builds 001-005)',
  },
  {
    supersededId: 'ROADMAP-M0-M7-SERIAL',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Historical M0-M7 Serial Delivery Sequence & Strict 10-Step List',
    specificationStatus: 'superseded',
    replacedBy:
      'Builds 001-005 verified vertical slices & Parallel Workstream Dependency DAG',
  },
  {
    supersededId: 'ADAPTER-OPAQUE-TEXT-ROW-01',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Opaque JSON-in-Native::Text Adapter for NEIGHBOR_ROW__01',
    specificationStatus: 'superseded',
    replacedBy:
      'Hybrid Native::Map fields (kind, title, status, NativeKind::Currency, NativeKind::Geo, Role edges)',
  },
  {
    supersededId: 'SUPERSEDED-QHARNESS-STANDALONE-POSTGRES',
    // i18n-ignore: canonical specification metadata, not a product label
    title: 'Separate SQLite / PostgreSQL Checkpoint Store for QHarness',
    specificationStatus: 'superseded',
    replacedBy:
      'Native Quanta Store + Ledger + Journal checkpointing in neighbor-workspace::qharness (NBR-DOC-004 / Build 006)',
  },
]);

/**
 * Deterministic `Object -> Capability` resolver (`NBR-BUILD-005` Section 4).
 * Maps an object's `kind`, `status`, and spatial/evidence attributes to applicable,
 * actually implemented OS capabilities without pretending every app handles every object.
 */
export function resolveCapabilitiesForObject(object) {
  if (!object || typeof object !== 'object') return [];
  const kind = String(object.kind || 'record');
  const hasCoords =
    Array.isArray(object.coordinates) &&
    object.coordinates.length >= 2 &&
    object.coordinates.every(Number.isFinite);

  const actions = [];
  if (hasCoords) {
    actions.push({
      actionId: 'world.flyTo',
      label: t('Fly to on Globe'),
      appId: 'records',
      capabilityId: 'CAP-QUANTA-HYBRID-RECORDS',
    });
  }
  if (['place', 'need', 'mission', 'task'].includes(kind)) {
    actions.push({
      actionId: 'projects.startFromObject',
      label: t('Create / Link Project'),
      appId: 'projects',
      capabilityId: 'CAP-PROJECT-PIPELINE',
    });
    actions.push({
      actionId: 'agent.planFromObject',
      label: t('Compile AI Plan'),
      appId: 'agent',
      capabilityId: 'CAP-INTENT-TO-OBJECT',
    });
  }
  if (
    ['place', 'need', 'project', 'market-offer', 'market-product'].includes(
      kind,
    )
  ) {
    actions.push({
      actionId: 'marketplace.sourceForObject',
      label: t('Source Offers & Proposals'),
      appId: 'marketplace',
      capabilityId: 'CAP-MARKET-PROPOSAL',
    });
  }
  if (kind === 'market-product') {
    actions.push({
      actionId: 'marketplace.exploreProduct',
      label: t('Explore Product Buying Options'),
      appId: 'marketplace',
      capabilityId: 'CAP-UNIVERSAL-PRODUCT-GRAPH',
    });
  }
  if (kind === 'proposal' && object.status === 'proposed') {
    actions.push({
      actionId: 'marketplace.commitProposal',
      label: t('Accept Terms & Mint Commitment'),
      appId: 'marketplace',
      capabilityId: 'CAP-PROPOSAL-TO-COMMITMENT',
    });
  }
  if (kind === 'commitment' && object.outcomeState !== 'verified_complete') {
    actions.push({
      actionId: 'marketplace.verifyOutcome',
      label: t('Verify Outcome with Evidence'),
      appId: 'marketplace',
      capabilityId: 'CAP-PROPOSAL-TO-COMMITMENT',
    });
  }
  if (
    [
      'project',
      'market-offer',
      'market-product',
      'place',
      'need',
      'mission',
      'commitment',
    ].includes(kind)
  ) {
    actions.push({
      actionId: 'social.shareObjectCard',
      label: t('Share Object Card in Social'),
      appId: 'social',
      capabilityId: 'CAP-SOCIAL-SHARED-CARDS',
    });
  }
  actions.push({
    actionId: 'history.inspectRevisions',
    label: t('Inspect As-Known History'),
    appId: 'history',
    capabilityId: 'CAP-WORLD-TIME-AS-KNOWN',
  });
  return actions;
}
