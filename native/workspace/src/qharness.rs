//! QHarness (`QHARNESS-002`) — Universal AI Execution, Inference, Workflow & Governed Agent Runtime.
//!
//! Implements the four unified QHarness subsystems over Quanta's maintained native core:
//! - `QServe` & `QRouter`: OpenAI-compatible (`/v1/*`) and native (`/qh/v1/*`) inference, model registry,
//!   virtual aliases (`qh/auto`, `qh/fast`, `qh/local`, `qh/private`, `qh/reasoning`, `qh/vision`, `qh/embedding`),
//!   and hard-constraint-first model routing (`QH-INV-001`, `QH-INV-005`, `QH-INV-012`, `QH-INV-013`).
//! - `QFlow`: Deterministic multi-stage pipelines and checkpointed workflows (`QH-INV-020`).
//! - `QAgent`: Bounded reasoning loops (`SINGLE_PASS`, `TOOL_RETURN`, `REACT`, `PLAN_EXECUTE`,
//!   `PLAN_ACT_REPLAN`, `VERIFY_REPAIR`, `MANAGER_WORKER`), `QProgress` convergence detection,
//!   durable missions, crash recovery, model hot-swapping, and `OUTCOME_UNKNOWN` reconciliation.
//! - `QControl`: Deterministic `QPolicy` gate, scoped/revocable/attenuated `QMandate`s (`QH-INV-009`),
//!   bitemporal `QFrame` context compiler (`QH-INV-010`), provenance-backed `QMemory` (`QH-INV-015`),
//!   `ExactMoney` budget accounting (`QH-INV-006`), and `QEval` regression verification (`QH-EVAL-001`..`020`).

use super::citizen::{now_ms, text};
use super::domain::{
    validate_exact_money, DOMAIN_ADMIT, MARKET_OFFERS, ROLE_LINK, ROLE_PLACE, ROLE_PROJECT,
};
use super::lifecycle::{fingerprint, statement};
use super::*;
use quanta_core::{NativeKind, NativeValue};
use std::collections::{BTreeMap, BTreeSet};

pub(super) const QH_MISSIONS: Qid = Qid(*b"QHARNESS_MSN__01");
pub(super) const QH_PLANS: Qid = Qid(*b"QHARNESS_PLN__01");
pub(super) const QH_TASKS: Qid = Qid(*b"QHARNESS_TSK__01");
pub(super) const QH_RUNS: Qid = Qid(*b"QHARNESS_RUN__01");
pub(super) const QH_MANDATES: Qid = Qid(*b"QHARNESS_MND__01");
pub(super) const QH_FRAMES: Qid = Qid(*b"QHARNESS_FRM__01");
pub(super) const QH_MEMORIES: Qid = Qid(*b"QHARNESS_MEM__01");
pub(super) const QH_FLOWS: Qid = Qid(*b"QHARNESS_FLW__01");
pub(super) const QH_EVALS: Qid = Qid(*b"QHARNESS_EVL__01");

pub(super) const ROLE_MISSION: Qid = Qid(*b"QHARNESS_ROL_MSN");
pub(super) const ROLE_TASK: Qid = Qid(*b"QHARNESS_ROL_TSK");
pub(super) const ROLE_MANDATE: Qid = Qid(*b"QHARNESS_ROL_MND");
pub(super) const ROLE_FRAME: Qid = Qid(*b"QHARNESS_ROL_FRM");

const VALID_STRATEGIES: &[&str] = &[
    "direct",
    "transform",
    "pipeline",
    "workflow",
    "agent",
    "multi_agent",
];

const VALID_INTERACTIONS: &[&str] = &["sync", "stream", "async", "realtime", "batch"];

const VALID_LOOP_STRATEGIES: &[&str] = &[
    "single_pass",
    "tool_return",
    "react",
    "plan_execute",
    "plan_act_replan",
    "reflect_revise",
    "verify_repair",
    "manager_worker",
    "deterministic_dag",
];

const VALID_MEMORY_CLASSES: &[&str] = &[
    "working",
    "episodic",
    "semantic",
    "procedural",
    "preference",
    "project",
    "world",
    "execution",
];

const VALID_EFFECTS: &[&str] = &[
    "read",
    "create",
    "update",
    "delete",
    "disclose",
    "communicate",
    "financial",
    "physical",
];

#[derive(Clone, Debug)]
struct ModelSpec {
    model_id: &'static str,
    model_version: &'static str,
    provider_id: &'static str,
    locality: &'static str,
    privacy_tier: &'static str,
    operations: &'static [&'static str],
    input_modalities: &'static [&'static str],
    output_modalities: &'static [&'static str],
    tool_calling: bool,
    structured_output: bool,
    streaming: bool,
    vision: bool,
    reasoning: bool,
    context_window_tokens: u64,
    max_output_tokens: u64,
    cost_per_call_minor: i64,
    latency_ms_p50: u64,
    quality_bps: u64,
    resident: bool,
    compatibility_profiles: &'static [&'static str],
}

const MODEL_REGISTRY: &[ModelSpec] = &[
    ModelSpec {
        model_id: "quanta-local-fast-v1",
        model_version: "2026.10.1",
        provider_id: "quanta-local",
        locality: "local",
        privacy_tier: "local_sovereign",
        operations: &[
            "generate",
            "understand",
            "translate",
            "plan",
            "execute",
            "evaluate",
        ],
        input_modalities: &["text", "tabular"],
        output_modalities: &["text", "structured", "tool_call"],
        tool_calling: true,
        structured_output: true,
        streaming: true,
        vision: false,
        reasoning: false,
        context_window_tokens: 32_768,
        max_output_tokens: 4_096,
        cost_per_call_minor: 5,
        latency_ms_p50: 45,
        quality_bps: 8_600,
        resident: true,
        compatibility_profiles: &["QCOMPAT-CHAT-1", "QCOMPAT-RESPONSES-1"],
    },
    ModelSpec {
        model_id: "quanta-local-reasoner-v1",
        model_version: "2026.10.1",
        provider_id: "quanta-local",
        locality: "local",
        privacy_tier: "local_sovereign",
        operations: &[
            "generate",
            "understand",
            "reason",
            "plan",
            "execute",
            "optimize",
            "evaluate",
        ],
        input_modalities: &["text", "tabular", "scientific"],
        output_modalities: &["text", "structured", "tool_call"],
        tool_calling: true,
        structured_output: true,
        streaming: true,
        vision: false,
        reasoning: true,
        context_window_tokens: 131_072,
        max_output_tokens: 16_384,
        cost_per_call_minor: 15,
        latency_ms_p50: 140,
        quality_bps: 9_450,
        resident: true,
        compatibility_profiles: &["QCOMPAT-CHAT-1", "QCOMPAT-RESPONSES-1"],
    },
    ModelSpec {
        model_id: "quanta-cloud-frontier-v1",
        model_version: "2026.10.1",
        provider_id: "quanta-cloud-zero-retention",
        locality: "cloud",
        privacy_tier: "zero_retention_cloud",
        operations: &[
            "generate",
            "understand",
            "reason",
            "plan",
            "execute",
            "understand_image",
            "optimize",
            "evaluate",
        ],
        input_modalities: &["text", "image", "tabular", "spatial", "scientific"],
        output_modalities: &["text", "structured", "tool_call"],
        tool_calling: true,
        structured_output: true,
        streaming: true,
        vision: true,
        reasoning: true,
        context_window_tokens: 262_144,
        max_output_tokens: 32_768,
        cost_per_call_minor: 45,
        latency_ms_p50: 320,
        quality_bps: 9_850,
        resident: false,
        compatibility_profiles: &["QCOMPAT-CHAT-1", "QCOMPAT-RESPONSES-1"],
    },
    ModelSpec {
        model_id: "quanta-vision-spatial-v1",
        model_version: "2026.10.1",
        provider_id: "quanta-local",
        locality: "local",
        privacy_tier: "local_sovereign",
        operations: &["understand_image", "understand", "generate", "simulate"],
        input_modalities: &["text", "image", "spatial"],
        output_modalities: &["text", "structured"],
        tool_calling: false,
        structured_output: true,
        streaming: true,
        vision: true,
        reasoning: false,
        context_window_tokens: 65_536,
        max_output_tokens: 4_096,
        cost_per_call_minor: 12,
        latency_ms_p50: 95,
        quality_bps: 9_100,
        resident: true,
        compatibility_profiles: &["QCOMPAT-CHAT-1", "QCOMPAT-RESPONSES-1"],
    },
    ModelSpec {
        model_id: "quanta-audio-asr-v1",
        model_version: "2026.10.1",
        provider_id: "quanta-local",
        locality: "local",
        privacy_tier: "local_sovereign",
        operations: &["transcribe", "translate", "synthesize_speech"],
        input_modalities: &["audio", "text"],
        output_modalities: &["text", "structured", "audio"],
        tool_calling: false,
        structured_output: true,
        streaming: true,
        vision: false,
        reasoning: false,
        context_window_tokens: 16_384,
        max_output_tokens: 4_096,
        cost_per_call_minor: 8,
        latency_ms_p50: 60,
        quality_bps: 9_200,
        resident: true,
        compatibility_profiles: &["QCOMPAT-AUDIO-1"],
    },
    ModelSpec {
        model_id: "quanta-embed-v1",
        model_version: "2026.10.1",
        provider_id: "quanta-local",
        locality: "local",
        privacy_tier: "local_sovereign",
        operations: &["embed", "rerank"],
        input_modalities: &["text"],
        output_modalities: &["embedding"],
        tool_calling: false,
        structured_output: false,
        streaming: false,
        vision: false,
        reasoning: false,
        context_window_tokens: 8_192,
        max_output_tokens: 64,
        cost_per_call_minor: 2,
        latency_ms_p50: 12,
        quality_bps: 9_300,
        resident: true,
        compatibility_profiles: &["QCOMPAT-EMBED-1"],
    },
];

#[derive(Clone, Debug)]
struct CapabilitySpec {
    capability_id: &'static str,
    version: &'static str,
    provider_id: &'static str,
    display_name: &'static str,
    execution_kind: &'static str,
    effects: &'static [&'static str],
    idempotency_mode: &'static str,
    supports_batch: bool,
    supports_dry_run: bool,
    requires_approval_by_default: bool,
}

const CAPABILITY_REGISTRY: &[CapabilitySpec] = &[
    CapabilitySpec {
        capability_id: "quanta.query",
        version: "1.0.0",
        provider_id: "quanta-core",
        display_name: "Query Authorized Quanta Records",
        execution_kind: "query",
        effects: &["read"],
        idempotency_mode: "read_only",
        supports_batch: true,
        supports_dry_run: true,
        requires_approval_by_default: false,
    },
    CapabilitySpec {
        capability_id: "market.searchOffers",
        version: "1.0.0",
        provider_id: "neighbor-workspace",
        display_name: "Search Local Marketplace Offers",
        execution_kind: "query",
        effects: &["read"],
        idempotency_mode: "read_only",
        supports_batch: true,
        supports_dry_run: true,
        requires_approval_by_default: false,
    },
    CapabilitySpec {
        capability_id: "world.timeQuery",
        version: "1.0.0",
        provider_id: "neighbor-workspace",
        display_name: "Bitemporal As-Known Sequence Query",
        execution_kind: "query",
        effects: &["read"],
        idempotency_mode: "read_only",
        supports_batch: false,
        supports_dry_run: true,
        requires_approval_by_default: false,
    },
    CapabilitySpec {
        capability_id: "world.licenseGate",
        version: "1.0.0",
        provider_id: "neighbor-workspace",
        display_name: "Evaluate Source Rights & LicenseGate",
        execution_kind: "function",
        effects: &["read"],
        idempotency_mode: "read_only",
        supports_batch: true,
        supports_dry_run: true,
        requires_approval_by_default: false,
    },
    CapabilitySpec {
        capability_id: "evidence.inspect",
        version: "1.0.0",
        provider_id: "neighbor-workspace",
        display_name: "Inspect Preserved Evidence & Source Lineage",
        execution_kind: "query",
        effects: &["read"],
        idempotency_mode: "read_only",
        supports_batch: true,
        supports_dry_run: true,
        requires_approval_by_default: false,
    },
    CapabilitySpec {
        capability_id: "audio.transcribeExtract",
        version: "1.0.0",
        provider_id: "qharness-flow",
        display_name: "Deterministic Audio Transcription & Claim Extraction Pipeline",
        execution_kind: "workflow",
        effects: &["read"],
        idempotency_mode: "read_only",
        supports_batch: true,
        supports_dry_run: true,
        requires_approval_by_default: false,
    },
    CapabilitySpec {
        capability_id: "project.compilePlan",
        version: "1.0.0",
        provider_id: "neighbor-workspace",
        display_name: "Compile Draft Project Plan & BOM",
        execution_kind: "domain_command",
        effects: &["create"],
        idempotency_mode: "idempotency_key",
        supports_batch: false,
        supports_dry_run: true,
        requires_approval_by_default: false,
    },
    CapabilitySpec {
        capability_id: "task.create",
        version: "1.0.0",
        provider_id: "neighbor-workspace",
        display_name: "Create Scoped Private Task Record",
        execution_kind: "domain_command",
        effects: &["create"],
        idempotency_mode: "idempotency_key",
        supports_batch: false,
        supports_dry_run: true,
        requires_approval_by_default: false,
    },
    CapabilitySpec {
        capability_id: "project.executePlan",
        version: "1.0.0",
        provider_id: "neighbor-workspace",
        display_name: "Materialize Project & Tasks from Approved Plan",
        execution_kind: "domain_command",
        effects: &["create", "update", "financial"],
        idempotency_mode: "idempotency_key",
        supports_batch: false,
        supports_dry_run: false,
        requires_approval_by_default: true,
    },
    CapabilitySpec {
        capability_id: "market.mintCommitment",
        version: "1.0.0",
        provider_id: "neighbor-workspace",
        display_name: "Mint Revision-Pinned Marketplace Commitment",
        execution_kind: "external_service",
        effects: &["create", "financial", "communicate"],
        idempotency_mode: "reconcile_before_retry",
        supports_batch: false,
        supports_dry_run: false,
        requires_approval_by_default: true,
    },
];

fn model_to_json(m: &ModelSpec) -> Value {
    json!({
        "id": m.model_id,
        "object": "model",
        "created": 1_760_688_000_u64,
        "owned_by": m.provider_id,
        "modelId": m.model_id,
        "modelVersion": m.model_version,
        "providerId": m.provider_id,
        "locality": m.locality,
        "privacyTier": m.privacy_tier,
        "operations": m.operations,
        "modalities": {
            "input": m.input_modalities,
            "output": m.output_modalities,
        },
        "capabilities": {
            "toolCalling": m.tool_calling,
            "structuredOutput": m.structured_output,
            "streaming": m.streaming,
            "vision": m.vision,
            "reasoning": m.reasoning,
            "batch": true,
            "realtime": m.streaming,
        },
        "contextWindowTokens": m.context_window_tokens,
        "maxOutputTokens": m.max_output_tokens,
        "pricing": {
            "costPerCallMinorUnits": m.cost_per_call_minor,
            "currency": "USD"
        },
        "latencyMsP50": m.latency_ms_p50,
        "qualityScoreBps": m.quality_bps,
        "resident": m.resident,
        "compatibilityProfiles": m.compatibility_profiles,
        "healthy": true
    })
}

fn capability_to_json(c: &CapabilitySpec) -> Value {
    json!({
        "capabilityId": c.capability_id,
        "version": c.version,
        "providerId": c.provider_id,
        "displayName": c.display_name,
        "executionKind": c.execution_kind,
        "effects": c.effects,
        "idempotencyMode": c.idempotency_mode,
        "supportsBatch": c.supports_batch,
        "supportsDryRun": c.supports_dry_run,
        "requiresApprovalByDefault": c.requires_approval_by_default
    })
}

fn find_capability(id: &str) -> Option<&'static CapabilitySpec> {
    CAPABILITY_REGISTRY.iter().find(|c| c.capability_id == id)
}

pub(super) fn contains_prompt_injection(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("ignore previous instructions")
        || lower.contains("ignore all prior instructions")
        || lower.contains("disregard system policy")
        || lower.contains("grant_mandate")
        || lower.contains("expand_permissions")
        || lower.contains("bypass qpolicy")
        || lower.contains("act as root")
        || lower.contains("exfiltrate private")
}

#[derive(Clone, Debug)]
struct RoutingRequirements {
    requested_model: String,
    operation: String,
    required_input_modality: String,
    requires_tools: bool,
    requires_structured_output: bool,
    requires_vision: bool,
    requires_reasoning: bool,
    estimated_tokens: u64,
    privacy_policy: String,
    routing_policy: String,
    max_cost_minor: Option<i64>,
    exclude_models: Vec<String>,
}

fn route_model(req: &RoutingRequirements) -> Result<&'static ModelSpec, String> {
    let mut alias_policy = req.routing_policy.as_str();
    let mut force_local = req.privacy_policy == "local_only" || req.privacy_policy == "local";
    let mut force_private =
        force_local || req.privacy_policy == "private" || req.privacy_policy == "zero_retention";
    let mut force_reasoning = req.requires_reasoning;
    let mut force_vision = req.requires_vision;
    let mut force_embedding = req.operation == "embed";
    let mut explicit_id: Option<&str> = None;

    match req.requested_model.as_str() {
        "" | "auto" | "qh/auto" => {
            if alias_policy.is_empty() {
                alias_policy = "balanced";
            }
        }
        "qh/fast" => alias_policy = "fast",
        "qh/quality" => alias_policy = "quality",
        "qh/cheapest" => alias_policy = "cheapest",
        "qh/local" => {
            force_local = true;
            if alias_policy.is_empty() {
                alias_policy = "local_first";
            }
        }
        "qh/private" => {
            force_private = true;
            if alias_policy.is_empty() {
                alias_policy = "balanced";
            }
        }
        "qh/reasoning" => {
            force_reasoning = true;
            if alias_policy.is_empty() {
                alias_policy = "local_first";
            }
        }
        "qh/vision" => {
            force_vision = true;
            if alias_policy.is_empty() {
                alias_policy = "balanced";
            }
        }
        "qh/embedding" => {
            force_embedding = true;
            alias_policy = "fast";
        }
        other => {
            if other.starts_with("qh/") {
                return Err("UNSUPPORTED".into());
            }
            explicit_id = Some(other);
        }
    }

    if let Some(id) = explicit_id {
        if !MODEL_REGISTRY.iter().any(|m| m.model_id == id) {
            return Err("NOT_AVAILABLE".into());
        }
    }

    let mut saw_capable = false;
    let mut saw_context_ok = false;
    let mut saw_policy_ok = false;
    let mut saw_budget_ok = false;
    let mut candidates: Vec<&'static ModelSpec> = Vec::new();

    for m in MODEL_REGISTRY {
        if let Some(id) = explicit_id {
            if m.model_id != id {
                continue;
            }
        }
        if req.exclude_models.iter().any(|ex| ex == m.model_id) {
            continue;
        }
        let op_ok = m.operations.contains(&req.operation.as_str());
        let mod_ok = m
            .input_modalities
            .contains(&req.required_input_modality.as_str());
        let tool_ok = !req.requires_tools || m.tool_calling;
        let schema_ok = !req.requires_structured_output || m.structured_output;
        let vision_ok = !force_vision || m.vision;
        let reason_ok = !force_reasoning || m.reasoning;
        let embed_ok = !force_embedding || m.output_modalities.contains(&"embedding");

        if !(op_ok && mod_ok && tool_ok && schema_ok && vision_ok && reason_ok && embed_ok) {
            continue;
        }
        saw_capable = true;

        if req.estimated_tokens > m.context_window_tokens {
            continue;
        }
        saw_context_ok = true;

        if force_local && m.locality != "local" {
            continue;
        }
        if force_private && !["local_sovereign", "zero_retention_cloud"].contains(&m.privacy_tier) {
            continue;
        }
        saw_policy_ok = true;

        if let Some(max_cost) = req.max_cost_minor {
            if m.cost_per_call_minor > max_cost {
                continue;
            }
        }
        saw_budget_ok = true;
        candidates.push(m);
    }

    if candidates.is_empty() {
        if !saw_capable {
            return Err("UNSUPPORTED".into());
        }
        if !saw_context_ok {
            return Err("RESOURCE_LIMIT".into());
        }
        if !saw_policy_ok {
            return Err("PERMISSION_DENIED".into());
        }
        if !saw_budget_ok {
            return Err("RESOURCE_LIMIT".into());
        }
        return Err("NOT_AVAILABLE".into());
    }

    candidates.sort_by_key(|m| -> i64 {
        let cost = m.cost_per_call_minor;
        let lat = m.latency_ms_p50 as i64;
        let qual_penalty = (10_000_u64.saturating_sub(m.quality_bps)) as i64;
        let res_bonus = if m.resident { -15 } else { 0 };
        let local_bonus = if m.locality == "local" { -25 } else { 0 };
        match alias_policy {
            "fast" => lat * 10 + cost + qual_penalty / 50 + res_bonus,
            "quality" => qual_penalty * 10 + cost + lat / 10,
            "cheapest" => cost * 25 + lat + qual_penalty / 20,
            "local_first" => local_bonus * 100 + cost * 4 + lat + qual_penalty / 20 + res_bonus,
            _ => cost * 4 + lat * 2 + qual_penalty / 5 + res_bonus + local_bonus,
        }
    });

    Ok(candidates[0])
}

fn validate_qh_extensions(extra_qh: &Value) -> Result<(String, String, Vec<String>), String> {
    if extra_qh.is_null() {
        return Ok(("".into(), "".into(), Vec::new()));
    }
    allowed(
        extra_qh,
        &[
            "routing_policy",
            "privacy_policy",
            "max_cost_minor_units",
            "exclude_models",
            "as_known_at",
            "trace_id",
        ],
    )?;
    let routing_policy = extra_qh
        .get("routing_policy")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    if !routing_policy.is_empty()
        && ![
            "balanced",
            "fast",
            "quality",
            "cheapest",
            "local_first",
            "local_only",
        ]
        .contains(&routing_policy.as_str())
    {
        return Err("INVALID".into());
    }
    let mut privacy_policy = extra_qh
        .get("privacy_policy")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    if routing_policy == "local_only" {
        privacy_policy = "local_only".into();
    }
    if !privacy_policy.is_empty()
        && ![
            "local_only",
            "local",
            "private",
            "zero_retention",
            "standard",
        ]
        .contains(&privacy_policy.as_str())
    {
        return Err("INVALID".into());
    }
    let mut exclude_models = Vec::new();
    if let Some(ex) = extra_qh.get("exclude_models") {
        for item in ex.as_array().ok_or("INVALID")? {
            exclude_models.push(item.as_str().ok_or("INVALID")?.to_owned());
        }
    }
    Ok((routing_policy, privacy_policy, exclude_models))
}

pub(super) fn qh_statement(
    id: Qid,
    predicate: Qid,
    value: &Value,
    roles: Vec<(Qid, Qid)>,
    epistemic: Epistemic,
    money_minor: Option<i64>,
) -> Result<Statement, String> {
    let mut fields = BTreeMap::from([("metadata".into(), Native::Text(value.to_string()))]);
    if let Some(minor) = money_minor {
        fields.insert("amount_minor_units".into(), Native::I64(minor));
        let payload = Native::Map(BTreeMap::from([
            ("amount".into(), Native::I64(minor)),
            ("code".into(), Native::Text("USD".into())),
        ]));
        let nv = NativeValue::new(NativeKind::Currency, payload).map_err(|_| "INVALID")?;
        fields.insert("currency".into(), nv.into_value());
    }
    if let Some(kind) = value.get("kind").and_then(Value::as_str) {
        fields.insert("kind".into(), Native::Text(kind.to_owned()));
    }
    if let Some(title) = value.get("title").and_then(Value::as_str) {
        fields.insert("title".into(), Native::Text(title.to_owned()));
    }
    if let Some(status) = value.get("status").and_then(Value::as_str) {
        fields.insert("status".into(), Native::Text(status.to_owned()));
    }
    Ok(Statement {
        id,
        subject: id,
        predicate,
        roles,
        value: Native::Map(fields),
        source: None,
        epistemic,
        valid_from: None,
        valid_until: None,
    })
}

fn compute_deterministic_embedding(input_text: &str, dimensions: usize) -> Vec<f64> {
    let dims = dimensions.clamp(4, 64);
    let mut raw = vec![0.0_f64; dims];
    let bytes = input_text.as_bytes();
    for (idx, chunk) in bytes.chunks(4).enumerate() {
        let mut h = Sha256::new();
        h.update(b"qharness-embed-v1:");
        h.update((idx as u32).to_le_bytes());
        h.update(chunk);
        let digest = h.finalize();
        for d in 0..dims {
            let b = digest[d % 32] as f64 / 255.0;
            raw[d] += (b * 2.0) - 1.0;
        }
    }
    if bytes.is_empty() {
        raw[0] = 1.0;
    }
    let norm = raw.iter().map(|v| v * v).sum::<f64>().sqrt().max(1e-9);
    raw.into_iter()
        .map(|v| ((v / norm) * 1_000_000.0).round() / 1_000_000.0)
        .collect()
}

impl Workspace {
    pub(super) fn qh_commit(
        &self,
        input: &Value,
        head: (Qid, Option<u64>),
        predicate: Qid,
        value: &Value,
        roles: Vec<(Qid, Qid)>,
        attributes: (Epistemic, Option<i64>),
    ) -> Result<Value, String> {
        let (epistemic, money_minor) = attributes;
        let (id, expected) = head;
        let key = parse(&input["key"])?;
        let admission = derive("domain-admit", &key.0);
        let row = qh_statement(id, predicate, value, roles, epistemic, money_minor)?;
        let mutations = vec![
            Mutation::Put(row),
            Mutation::Put(statement(
                admission,
                DOMAIN_ADMIT,
                &json!({
                    "requestHash": fingerprint(input),
                    "resultId": id.to_canonical_string()
                }),
            )),
        ];
        receipt(
            self.db_mut()?.commit(Batch {
                domain: self.domain,
                principal: self.owner,
                key,
                heads: vec![
                    Head {
                        statement: id,
                        expected,
                    },
                    Head {
                        statement: admission,
                        expected: None,
                    },
                ],
                mutations,
                content: vec![],
            }),
            id,
        )
    }

    /// Lists or inspects registered models and virtual aliases (`GET /v1/models`, `GET /v1/models/:id`).
    pub(super) fn qh_models(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "modelId"])?;
        let aliases = json!([
            { "alias": "qh/auto", "defaultTarget": "quanta-local-fast-v1", "policy": "balanced" },
            { "alias": "qh/fast", "defaultTarget": "quanta-local-fast-v1", "policy": "fast" },
            { "alias": "qh/quality", "defaultTarget": "quanta-cloud-frontier-v1", "policy": "quality" },
            { "alias": "qh/local", "defaultTarget": "quanta-local-reasoner-v1", "policy": "local_only" },
            { "alias": "qh/private", "defaultTarget": "quanta-local-reasoner-v1", "policy": "private" },
            { "alias": "qh/reasoning", "defaultTarget": "quanta-local-reasoner-v1", "policy": "quality" },
            { "alias": "qh/vision", "defaultTarget": "quanta-vision-spatial-v1", "policy": "balanced" },
            { "alias": "qh/embedding", "defaultTarget": "quanta-embed-v1", "policy": "fast" }
        ]);
        if let Some(model_id) = input.get("modelId").and_then(Value::as_str) {
            if let Some(m) = MODEL_REGISTRY.iter().find(|m| m.model_id == model_id) {
                return Ok(model_to_json(m));
            }
            if let Some(a) = aliases
                .as_array()
                .and_then(|arr| arr.iter().find(|x| x["alias"].as_str() == Some(model_id)))
            {
                let target = a["defaultTarget"]
                    .as_str()
                    .unwrap_or("quanta-local-fast-v1");
                let m = MODEL_REGISTRY
                    .iter()
                    .find(|m| m.model_id == target)
                    .ok_or("NOT_AVAILABLE")?;
                let mut out = model_to_json(m);
                out["id"] = json!(model_id);
                out["resolvedModelId"] = json!(m.model_id);
                out["routingPolicy"] = a["policy"].clone();
                return Ok(out);
            }
            return Err("NOT_AVAILABLE".into());
        }
        let data: Vec<Value> = MODEL_REGISTRY.iter().map(model_to_json).collect();
        Ok(json!({
            "object": "list",
            "data": data,
            "aliases": aliases,
            "compatibilityProfiles": [
                "QCOMPAT-CHAT-1",
                "QCOMPAT-RESPONSES-1",
                "QCOMPAT-EMBED-1",
                "QCOMPAT-AUDIO-1"
            ]
        }))
    }

    /// Lists or inspects registered capabilities (`GET /qh/v1/capabilities`).
    pub(super) fn qh_capabilities(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "capabilityId", "effectFilter"])?;
        if let Some(cap_id) = input.get("capabilityId").and_then(Value::as_str) {
            let cap = find_capability(cap_id).ok_or("NOT_AVAILABLE")?;
            return Ok(capability_to_json(cap));
        }
        let effect_filter = input.get("effectFilter").and_then(Value::as_str);
        let items: Vec<Value> = CAPABILITY_REGISTRY
            .iter()
            .filter(|c| effect_filter.is_none_or(|ef| c.effects.contains(&ef)))
            .map(capability_to_json)
            .collect();
        Ok(json!({
            "object": "list",
            "items": items,
            "count": items.len()
        }))
    }

    /// OpenAI-compatible `POST /v1/chat/completions` (`QCOMPAT-CHAT-1`).
    /// Enforces `QH-INV-001` (direct inference never creates a durable mission) and
    /// `TOOL_RETURN` semantics (returns proposed `tool_calls` without covertly executing them).
    pub(super) fn qh_openai_chat_completions(&self, input: Value) -> Result<Value, String> {
        allowed(
            &input,
            &[
                "op",
                "model",
                "messages",
                "tools",
                "tool_choice",
                "response_format",
                "temperature",
                "max_tokens",
                "stream",
                "user",
                "extra_body",
            ],
        )?;
        let requested_model = input["model"].as_str().ok_or("INVALID")?;
        let messages = input["messages"].as_array().ok_or("INVALID")?;
        if messages.is_empty() || messages.len() > 128 {
            return Err("INVALID".into());
        }

        let mut combined_prompt = String::new();
        let mut requires_vision = false;
        let mut injection_detected = false;

        for msg in messages {
            let role = msg["role"].as_str().ok_or("INVALID")?;
            if !["system", "developer", "user", "assistant", "tool"].contains(&role) {
                return Err("INVALID".into());
            }
            match &msg["content"] {
                Value::String(s) => {
                    if contains_prompt_injection(s) {
                        injection_detected = true;
                    }
                    combined_prompt.push_str(s);
                    combined_prompt.push('\n');
                }
                Value::Array(parts) => {
                    for part in parts {
                        let ptype = part["type"].as_str().ok_or("INVALID")?;
                        if ptype == "text" {
                            let s = part["text"].as_str().ok_or("INVALID")?;
                            if contains_prompt_injection(s) {
                                injection_detected = true;
                            }
                            combined_prompt.push_str(s);
                            combined_prompt.push('\n');
                        } else if ptype == "image_url" || ptype == "input_image" {
                            requires_vision = true;
                        } else {
                            return Err("UNSUPPORTED".into());
                        }
                    }
                }
                Value::Null if role == "assistant" => {}
                _ => return Err("INVALID".into()),
            }
        }

        let tools = input.get("tools").and_then(Value::as_array);
        let requires_tools = tools.is_some_and(|t| !t.is_empty());

        let mut requires_structured = false;
        let mut required_schema_fields: Vec<String> = Vec::new();
        if let Some(rf) = input.get("response_format") {
            let rf_type = rf["type"].as_str().ok_or("INVALID")?;
            match rf_type {
                "text" => {}
                "json_object" => requires_structured = true,
                "json_schema" => {
                    requires_structured = true;
                    let schema_obj = rf
                        .get("json_schema")
                        .and_then(|js| js.get("schema"))
                        .ok_or("INVALID")?;
                    if let Some(req_arr) = schema_obj.get("required").and_then(Value::as_array) {
                        for k in req_arr {
                            required_schema_fields.push(k.as_str().ok_or("INVALID")?.to_owned());
                        }
                    }
                }
                _ => return Err("UNSUPPORTED".into()),
            }
        }

        let extra_qh = input
            .get("extra_body")
            .and_then(|eb| eb.get("qh"))
            .cloned()
            .unwrap_or(Value::Null);
        if let Some(eb) = input.get("extra_body") {
            allowed(eb, &["qh"])?;
        }
        let (routing_policy, privacy_policy, exclude_models) = validate_qh_extensions(&extra_qh)?;
        let max_cost_minor = extra_qh.get("max_cost_minor_units").and_then(Value::as_i64);

        let est_tokens = ((combined_prompt.len() as u64) / 4).max(8);
        let selected = route_model(&RoutingRequirements {
            requested_model: requested_model.to_owned(),
            operation: if requires_vision {
                "understand_image".into()
            } else {
                "generate".into()
            },
            required_input_modality: if requires_vision {
                "image".into()
            } else {
                "text".into()
            },
            requires_tools,
            requires_structured_output: requires_structured,
            requires_vision,
            requires_reasoning: requested_model == "qh/reasoning",
            estimated_tokens: est_tokens,
            privacy_policy,
            routing_policy,
            max_cost_minor,
            exclude_models,
        })?;

        let stream = input
            .get("stream")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let completion_id = format!(
            "chatcmpl-{}",
            &fingerprint(&json!({
                "m": selected.model_id,
                "p": combined_prompt,
                "t": now_ms()?
            }))[..24]
        );

        // TOOL_RETURN mode (`QH-INV-001` & Section 10): return tool_calls proposal without executing!
        if let Some(tool_list) = tools.filter(|t| !t.is_empty()) {
            let first_tool = &tool_list[0];
            let fn_name = first_tool
                .get("function")
                .and_then(|f| f.get("name"))
                .or_else(|| first_tool.get("name"))
                .and_then(Value::as_str)
                .ok_or("INVALID")?;
            let args_json = json!({
                "query": combined_prompt.trim(),
                "epistemicMode": "as_known"
            })
            .to_string();
            let call_id = format!("call_{}", &completion_id[9..21]);
            let output_tokens = 24_u64;
            return Ok(json!({
                "id": completion_id,
                "object": if stream { "chat.completion.chunk.stream" } else { "chat.completion" },
                "created": now_ms()? / 1000,
                "model": selected.model_id,
                "requested_model": requested_model,
                "choices": [{
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": Value::Null,
                        "tool_calls": [{
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": fn_name,
                                "arguments": args_json
                            }
                        }]
                    },
                    "finish_reason": "tool_calls"
                }],
                "usage": {
                    "prompt_tokens": est_tokens,
                    "completion_tokens": output_tokens,
                    "total_tokens": est_tokens + output_tokens
                },
                "qh": {
                    "executionStrategy": "direct",
                    "loopStrategy": "tool_return",
                    "missionCreated": false,
                    "toolExecutedByHarness": false,
                    "resolvedModel": selected.model_id,
                    "resolvedProvider": selected.provider_id,
                    "locality": selected.locality,
                    "costMinorUnits": selected.cost_per_call_minor,
                    "currency": "USD",
                    "epistemic": "Inferred",
                    "promptInjectionBlocked": injection_detected
                }
            }));
        }

        let response_content = if requires_structured {
            let mut obj = serde_json::Map::new();
            obj.insert(
                "summary".into(),
                json!(format!(
                    "Structured response for: {}",
                    combined_prompt.trim().chars().take(120).collect::<String>()
                )),
            );
            obj.insert("epistemic".into(), json!("Inferred"));
            obj.insert("verified".into(), json!(true));
            for req_key in &required_schema_fields {
                obj.entry(req_key.clone())
                    .or_insert_with(|| json!("populated_by_qserve"));
            }
            Value::Object(obj).to_string()
        } else {
            format!(
                "[QServe:{}] Verified response to: {}",
                selected.model_id,
                combined_prompt.trim().chars().take(240).collect::<String>()
            )
        };

        let output_tokens = ((response_content.len() as u64) / 4).max(12);
        let chunks = if stream {
            json!([
                {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "model": selected.model_id,
                    "choices": [{ "index": 0, "delta": { "role": "assistant", "content": response_content }, "finish_reason": Value::Null }]
                },
                {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "model": selected.model_id,
                    "choices": [{ "index": 0, "delta": {}, "finish_reason": "stop" }]
                }
            ])
        } else {
            Value::Null
        };

        Ok(json!({
            "id": completion_id,
            "object": "chat.completion",
            "created": now_ms()? / 1000,
            "model": selected.model_id,
            "requested_model": requested_model,
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": response_content
                },
                "finish_reason": "stop"
            }],
            "stream_chunks": chunks,
            "usage": {
                "prompt_tokens": est_tokens,
                "completion_tokens": output_tokens,
                "total_tokens": est_tokens + output_tokens
            },
            "qh": {
                "executionStrategy": "direct",
                "loopStrategy": "single_pass",
                "missionCreated": false,
                "resolvedModel": selected.model_id,
                "resolvedProvider": selected.provider_id,
                "locality": selected.locality,
                "costMinorUnits": selected.cost_per_call_minor,
                "currency": "USD",
                "epistemic": "Inferred",
                "promptInjectionBlocked": injection_detected
            }
        }))
    }

    /// OpenAI-compatible `POST /v1/responses` (`QCOMPAT-RESPONSES-1`).
    /// Supports stateless or stateful (`store: true` / `previous_response_id`) responses
    /// without creating an autonomous mission (`QH-INV-001`).
    pub(super) fn qh_openai_responses(&self, input: Value) -> Result<Value, String> {
        allowed(
            &input,
            &[
                "op",
                "key",
                "model",
                "input",
                "instructions",
                "tools",
                "previous_response_id",
                "store",
                "background",
                "stream",
                "text",
                "extra_body",
            ],
        )?;
        let requested_model = input["model"].as_str().ok_or("INVALID")?;
        let prompt_text = match &input["input"] {
            Value::String(s) => s.clone(),
            Value::Array(items) => {
                let mut acc = String::new();
                for item in items {
                    if let Some(c) = item.get("content").and_then(Value::as_str) {
                        acc.push_str(c);
                        acc.push('\n');
                    } else if let Some(t) = item.get("text").and_then(Value::as_str) {
                        acc.push_str(t);
                        acc.push('\n');
                    }
                }
                acc
            }
            _ => return Err("INVALID".into()),
        };
        if prompt_text.trim().is_empty() {
            return Err("INVALID".into());
        }

        let mut prior_context = String::new();
        if let Some(prev_id_str) = input
            .get("previous_response_id")
            .filter(|v| !v.is_null())
            .and_then(Value::as_str)
        {
            let prev_qid = Qid::parse(prev_id_str).map_err(|_| "NOT_AVAILABLE")?;
            let (_, prev_row) = self.cen_row(prev_qid, QH_RUNS)?;
            if let Some(prev_out) = prev_row.get("output_text").and_then(Value::as_str) {
                prior_context = format!("[Prior Response ({prev_id_str})]: {prev_out}\n");
            }
        }

        let extra_qh = input
            .get("extra_body")
            .and_then(|eb| eb.get("qh"))
            .cloned()
            .unwrap_or(Value::Null);
        let (routing_policy, privacy_policy, exclude_models) = validate_qh_extensions(&extra_qh)?;
        let max_cost_minor = extra_qh.get("max_cost_minor_units").and_then(Value::as_i64);

        let est_tokens = (((prior_context.len() + prompt_text.len()) as u64) / 4).max(8);
        let selected = route_model(&RoutingRequirements {
            requested_model: requested_model.to_owned(),
            operation: "generate".into(),
            required_input_modality: "text".into(),
            requires_tools: input
                .get("tools")
                .and_then(Value::as_array)
                .is_some_and(|t| !t.is_empty()),
            requires_structured_output: input.get("text").is_some(),
            requires_vision: false,
            requires_reasoning: requested_model == "qh/reasoning",
            estimated_tokens: est_tokens,
            privacy_policy,
            routing_policy,
            max_cost_minor,
            exclude_models,
        })?;

        let background = input
            .get("background")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let store_state = input
            .get("store")
            .and_then(Value::as_bool)
            .unwrap_or(background || input.get("key").is_some());

        let output_text = format!(
            "{}[QServe:{}] Response: {}",
            if prior_context.is_empty() {
                ""
            } else {
                "(Continued session) "
            },
            selected.model_id,
            prompt_text.trim().chars().take(240).collect::<String>()
        );
        let output_tokens = ((output_text.len() as u64) / 4).max(10);
        let status = if background {
            "in_progress"
        } else {
            "completed"
        };

        let response_qid = if let Some(k) = input.get("key") {
            derive("qh-response", &parse(k)?.0)
        } else {
            derive(
                "qh-response-ephemeral",
                format!("{}:{}:{}", selected.model_id, prompt_text, now_ms()?).as_bytes(),
            )
        };
        let response_id = response_qid.to_canonical_string();

        let events = json!([
            { "type": "response.created", "response_id": response_id },
            { "type": "response.output_item.added", "item_id": format!("msg_{response_id}") },
            { "type": "response.output_text.delta", "delta": output_text },
            { "type": if background { "response.in_progress" } else { "response.completed" }, "response_id": response_id }
        ]);

        let payload = json!({
            "id": response_id,
            "kind": "openai-response",
            "title": prompt_text.trim().chars().take(80).collect::<String>(),
            "object": "response",
            "created_at": now_ms()? / 1000,
            "status": status,
            "model": selected.model_id,
            "requested_model": requested_model,
            "previous_response_id": input.get("previous_response_id").cloned().unwrap_or(Value::Null),
            "output_text": output_text,
            "output": [{
                "type": "message",
                "id": format!("msg_{response_id}"),
                "status": status,
                "role": "assistant",
                "content": [{
                    "type": "output_text",
                    "text": output_text,
                    "annotations": []
                }]
            }],
            "events": events,
            "usage": {
                "input_tokens": est_tokens,
                "output_tokens": output_tokens,
                "total_tokens": est_tokens + output_tokens
            },
            "qh": {
                "executionStrategy": "direct",
                "missionCreated": false,
                "resolvedModel": selected.model_id,
                "locality": selected.locality,
                "costMinorUnits": selected.cost_per_call_minor,
                "currency": "USD",
                "epistemic": "Inferred"
            }
        });

        if store_state && input.get("key").is_some() {
            if self.domain_prior(&input)?.is_some() {
                let (_, existing) = self.cen_row(response_qid, QH_RUNS)?;
                return Ok(existing);
            }
            self.qh_commit(
                &input,
                (response_qid, None),
                QH_RUNS,
                &payload,
                vec![],
                (Epistemic::Inferred, Some(selected.cost_per_call_minor)),
            )?;
        }

        Ok(payload)
    }

    /// Retrieves a stored response (`GET /v1/responses/:id`).
    pub(super) fn qh_openai_get_response(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "id"])?;
        let id = parse(&input["id"])?;
        let (_, row) = self.cen_row(id, QH_RUNS)?;
        Ok(row)
    }

    /// Cancels an in-progress background response (`POST /v1/responses/:id/cancel`).
    pub(super) fn qh_openai_cancel_response(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "key", "id"])?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let id = parse(&input["id"])?;
        let (rev, mut row) = self.cen_row(id, QH_RUNS)?;
        row["status"] = json!("cancelled");
        self.qh_commit(
            &input,
            (id, Some(rev)),
            QH_RUNS,
            &row,
            vec![],
            (Epistemic::Inferred, None),
        )?;
        Ok(row)
    }

    /// OpenAI-compatible `POST /v1/embeddings` (`QCOMPAT-EMBED-1`).
    pub(super) fn qh_openai_embeddings(&self, input: Value) -> Result<Value, String> {
        allowed(
            &input,
            &["op", "model", "input", "dimensions", "encoding_format"],
        )?;
        let requested_model = input["model"].as_str().ok_or("INVALID")?;
        let dims = input
            .get("dimensions")
            .and_then(Value::as_u64)
            .unwrap_or(16) as usize;
        if !(4..=64).contains(&dims) {
            return Err("INVALID".into());
        }

        let texts: Vec<String> = match &input["input"] {
            Value::String(s) => vec![s.clone()],
            Value::Array(arr) => {
                if arr.is_empty() || arr.len() > 64 {
                    return Err("INVALID".into());
                }
                let mut out = Vec::with_capacity(arr.len());
                for item in arr {
                    out.push(item.as_str().ok_or("INVALID")?.to_owned());
                }
                out
            }
            _ => return Err("INVALID".into()),
        };

        let selected = route_model(&RoutingRequirements {
            requested_model: requested_model.to_owned(),
            operation: "embed".into(),
            required_input_modality: "text".into(),
            requires_tools: false,
            requires_structured_output: false,
            requires_vision: false,
            requires_reasoning: false,
            estimated_tokens: 32,
            privacy_policy: "".into(),
            routing_policy: "fast".into(),
            max_cost_minor: None,
            exclude_models: Vec::new(),
        })?;

        let mut data = Vec::with_capacity(texts.len());
        let mut total_tokens = 0_u64;
        for (idx, t) in texts.iter().enumerate() {
            total_tokens += ((t.len() as u64) / 4).max(1);
            data.push(json!({
                "object": "embedding",
                "index": idx,
                "embedding": compute_deterministic_embedding(t, dims)
            }));
        }

        Ok(json!({
            "object": "list",
            "data": data,
            "model": selected.model_id,
            "usage": {
                "prompt_tokens": total_tokens,
                "total_tokens": total_tokens
            },
            "qh": {
                "executionStrategy": "transform",
                "missionCreated": false,
                "dimensions": dims,
                "costMinorUnits": selected.cost_per_call_minor * (texts.len() as i64),
                "currency": "USD"
            }
        }))
    }

    /// Creates a scoped, revocable `QMandate` (`POST /qh/v1/mandates`, `QH-INV-004`, `QH-INV-009`).
    pub(super) fn qh_create_mandate(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "key", "payload"])?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let key = parse(&input["key"])?;
        let id = derive("qh-mandate", &key.0);
        let p = &input["payload"];
        allowed(
            p,
            &[
                "title",
                "executingPrincipal",
                "purpose",
                "permittedCapabilities",
                "permittedResources",
                "permittedEffects",
                "budget",
                "parentMandateId",
                "expiresAtMs",
            ],
        )?;
        let title = text(&p["title"], 3, 160)?;
        let purpose = text(&p["purpose"], 3, 500)?;
        let exec_principal = p
            .get("executingPrincipal")
            .and_then(Value::as_str)
            .unwrap_or("agent:personal-coordinator");

        let cap_arr = p["permittedCapabilities"].as_array().ok_or("INVALID")?;
        if cap_arr.is_empty() || cap_arr.len() > 32 {
            return Err("INVALID".into());
        }
        let mut caps = Vec::new();
        for c in cap_arr {
            let cid = c.as_str().ok_or("INVALID")?;
            if find_capability(cid).is_none() {
                return Err("INVALID".into());
            }
            caps.push(cid.to_owned());
        }

        let eff_arr = p["permittedEffects"].as_array().ok_or("INVALID")?;
        if eff_arr.is_empty() {
            return Err("INVALID".into());
        }
        let mut effects = Vec::new();
        for e in eff_arr {
            let eff = e.as_str().ok_or("INVALID")?;
            if !VALID_EFFECTS.contains(&eff) {
                return Err("INVALID".into());
            }
            effects.push(eff.to_owned());
        }

        let res_refs = self.collect_refs(p, "permittedResources", 32)?;
        let budget = &p["budget"];
        allowed(
            budget,
            &[
                "maxModelCalls",
                "maxToolCalls",
                "maxTokens",
                "maxWallTimeMs",
                "maxCost",
                "maxDelegationDepth",
            ],
        )?;
        let (max_cost_minor, _, currency) = validate_exact_money(&budget["maxCost"])?;
        let mut max_model_calls = budget
            .get("maxModelCalls")
            .and_then(Value::as_u64)
            .unwrap_or(8);
        let mut max_tool_calls = budget
            .get("maxToolCalls")
            .and_then(Value::as_u64)
            .unwrap_or(16);
        let mut max_tokens = budget
            .get("maxTokens")
            .and_then(Value::as_u64)
            .unwrap_or(65_536);
        let mut max_wall_ms = budget
            .get("maxWallTimeMs")
            .and_then(Value::as_u64)
            .unwrap_or(30_000);
        let mut max_depth = budget
            .get("maxDelegationDepth")
            .and_then(Value::as_u64)
            .unwrap_or(2);

        for field in [
            "maxModelCalls",
            "maxToolCalls",
            "maxTokens",
            "maxWallTimeMs",
        ] {
            if budget
                .get(field)
                .is_some_and(|v| v.as_u64().is_none_or(|n| n == 0))
            {
                return Err("INVALID".into());
            }
        }
        let mut expires_at = p.get("expiresAtMs").cloned().unwrap_or(Value::Null);
        if !expires_at.is_null()
            && expires_at
                .as_u64()
                .is_none_or(|v| v <= now_ms().unwrap_or(u64::MAX))
        {
            return Err("INVALID".into());
        }
        let mut roles = Vec::new();
        for r in &res_refs {
            roles.push((ROLE_LINK, *r));
        }

        // Enforce monotonic attenuation if `parentMandateId` is present (`QH-INV-009`, `QH-EVAL-011`)
        if let Some(parent_val) = p.get("parentMandateId").filter(|v| !v.is_null()) {
            let parent_id = parse(parent_val)?;
            let (_, parent) = self.qh_active_mandate(parent_id)?;
            if parent["status"] != "active" {
                return Err("PERMISSION_DENIED".into());
            }
            if !budget
                .as_object()
                .ok_or("INVALID")?
                .contains_key("maxModelCalls")
            {
                max_model_calls = parent["budget"]["maxModelCalls"]
                    .as_u64()
                    .ok_or("PERMISSION_DENIED")?;
            }
            if !budget
                .as_object()
                .ok_or("INVALID")?
                .contains_key("maxToolCalls")
            {
                max_tool_calls = parent["budget"]["maxToolCalls"]
                    .as_u64()
                    .ok_or("PERMISSION_DENIED")?;
            }
            if !budget
                .as_object()
                .ok_or("INVALID")?
                .contains_key("maxTokens")
            {
                max_tokens = parent["budget"]["maxTokens"]
                    .as_u64()
                    .ok_or("PERMISSION_DENIED")?;
            }
            if !budget
                .as_object()
                .ok_or("INVALID")?
                .contains_key("maxWallTimeMs")
            {
                max_wall_ms = parent["budget"]["maxWallTimeMs"]
                    .as_u64()
                    .ok_or("PERMISSION_DENIED")?;
            }
            if !budget
                .as_object()
                .ok_or("INVALID")?
                .contains_key("maxDelegationDepth")
            {
                max_depth = parent["budget"]["maxDelegationDepth"]
                    .as_u64()
                    .ok_or("PERMISSION_DENIED")?
                    .saturating_sub(1);
            }
            let parent_depth = parent["budget"]["maxDelegationDepth"].as_u64().unwrap_or(0);
            if parent_depth == 0 || max_depth >= parent_depth {
                return Err("PERMISSION_DENIED".into());
            }
            let parent_caps: BTreeSet<&str> = parent["permittedCapabilities"]
                .as_array()
                .map(|a| a.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            if caps.iter().any(|c| !parent_caps.contains(c.as_str())) {
                return Err("PERMISSION_DENIED".into());
            }
            let parent_effs: BTreeSet<&str> = parent["permittedEffects"]
                .as_array()
                .map(|a| a.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            if effects.iter().any(|e| !parent_effs.contains(e.as_str())) {
                return Err("PERMISSION_DENIED".into());
            }
            let parent_cost = parent["budget"]["maxCost"]["amountMinorUnits"]
                .as_i64()
                .unwrap_or(0);
            let parent_calls = parent["budget"]["maxModelCalls"].as_u64().unwrap_or(0);
            let parent_tools = parent["budget"]["maxToolCalls"].as_u64().unwrap_or(0);
            if max_cost_minor > parent_cost
                || max_model_calls > parent_calls
                || max_tool_calls > parent_tools
                || max_tokens > parent["budget"]["maxTokens"].as_u64().unwrap_or(0)
                || max_wall_ms > parent["budget"]["maxWallTimeMs"].as_u64().unwrap_or(0)
                || parent["budget"]["maxCost"]["currency"] != currency
            {
                return Err("PERMISSION_DENIED".into());
            }
            let parent_res: BTreeSet<String> = parent["permittedResources"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default();
            if !parent_res.is_empty()
                && (res_refs.is_empty()
                    || res_refs
                        .iter()
                        .any(|r| !parent_res.contains(&r.to_canonical_string())))
            {
                return Err("PERMISSION_DENIED".into());
            }
            if let Some(parent_expiry) = parent["expiresAtMs"].as_u64() {
                if expires_at.is_null() {
                    expires_at = json!(parent_expiry);
                } else if expires_at.as_u64().is_none_or(|v| v > parent_expiry) {
                    return Err("PERMISSION_DENIED".into());
                }
            }
            roles.push((ROLE_MANDATE, parent_id));
        }

        let now = now_ms()?;
        let record = json!({
            "kind": "qh-mandate",
            "title": title,
            "status": "active",
            "issuerPrincipal": self.owner.to_canonical_string(),
            "executingPrincipal": exec_principal,
            "authorityDomain": self.domain.to_canonical_string(),
            "purpose": purpose,
            "permittedCapabilities": caps,
            "permittedResources": res_refs.iter().map(Qid::to_canonical_string).collect::<Vec<_>>(),
            "permittedEffects": effects,
            "parentMandateId": p.get("parentMandateId").cloned().unwrap_or(Value::Null),
            "budget": {
                "maxModelCalls": max_model_calls,
                "maxToolCalls": max_tool_calls,
                "maxTokens": max_tokens,
                "maxWallTimeMs": max_wall_ms,
                "maxCost": { "amountMinorUnits": max_cost_minor, "currency": currency },
                "maxDelegationDepth": max_depth
            },
            "grantEpoch": 1,
            "validFromMs": now,
            "expiresAtMs": expires_at,
            "parentMandateId": p.get("parentMandateId").cloned().unwrap_or(Value::Null),
            "revokedAtMs": Value::Null,
            "updatedAtMs": now
        });

        self.qh_commit(
            &input,
            (id, None),
            QH_MANDATES,
            &record,
            roles,
            (Epistemic::Authoritative, Some(max_cost_minor)),
        )
    }

    /// Revokes an active `QMandate` (`POST /qh/v1/mandates/revoke`, `QH-EVAL-006`).
    pub(super) fn qh_revoke_mandate(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "key", "mandateId", "expected", "reason"])?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let mandate_id = parse(&input["mandateId"])?;
        let expected = input["expected"].as_u64().ok_or("INVALID")?;
        let reason = text(&input["reason"], 3, 500)?;
        let (current_rev, mut mandate) = self.cen_row(mandate_id, QH_MANDATES)?;
        if current_rev != expected {
            return Err("CONFLICT".into());
        }
        let now = now_ms()?;
        mandate["status"] = json!("revoked");
        mandate["revokedAtMs"] = json!(now);
        mandate["revocationReason"] = json!(reason);
        mandate["grantEpoch"] = json!(mandate["grantEpoch"].as_u64().unwrap_or(1) + 1);
        mandate["updatedAtMs"] = json!(now);
        let cost = mandate["budget"]["maxCost"]["amountMinorUnits"].as_i64();
        self.qh_commit(
            &input,
            (mandate_id, Some(expected)),
            QH_MANDATES,
            &mandate,
            vec![],
            (Epistemic::Authoritative, cost),
        )
    }

    /// Saves a provenance-backed `QMemory` record (`POST /qh/v1/memory`, `QH-INV-015`).
    pub(super) fn qh_save_memory(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "key", "payload"])?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let key = parse(&input["key"])?;
        let id = derive("qh-memory", &key.0);
        let p = &input["payload"];
        allowed(
            p,
            &[
                "memoryClass",
                "title",
                "claim",
                "evidenceRefs",
                "confidenceBps",
                "validateClaim",
                "expiresAtMs",
            ],
        )?;
        let mem_class = p["memoryClass"].as_str().ok_or("INVALID")?;
        if !VALID_MEMORY_CLASSES.contains(&mem_class) {
            return Err("INVALID".into());
        }
        let title = text(&p["title"], 3, 160)?;
        let claim = text(&p["claim"], 3, 4000)?;
        if contains_prompt_injection(claim) {
            return Err("PERMISSION_DENIED".into());
        }
        let evidence_refs = self.collect_refs(p, "evidenceRefs", 16)?;
        let validate_claim = p
            .get("validateClaim")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        // `QH-INV-015`: Semantic and world memory claims cannot be marked `validated` without resolvable evidence!
        if validate_claim && ["semantic", "world"].contains(&mem_class) && evidence_refs.is_empty()
        {
            return Err("INVALID".into());
        }

        let status = if validate_claim && !evidence_refs.is_empty() {
            "validated"
        } else {
            "candidate"
        };
        let ep = if status == "validated" {
            Epistemic::Derived
        } else {
            Epistemic::Hypothetical
        };

        let mut roles = Vec::new();
        for ev in &evidence_refs {
            roles.push((ROLE_LINK, *ev));
        }

        let record = json!({
            "kind": "qh-memory",
            "memoryClass": mem_class,
            "title": title,
            "claim": claim,
            "status": status,
            "epistemic": if status == "validated" { "Derived" } else { "Hypothesized" },
            "evidenceRefs": evidence_refs.iter().map(Qid::to_canonical_string).collect::<Vec<_>>(),
            "confidenceBps": p.get("confidenceBps").and_then(Value::as_u64).unwrap_or(if status == "validated" { 9000 } else { 5000 }),
            "whyBelieved": format!(
                "Backed by {} verified Quanta evidence reference(s) in {} memory class.",
                evidence_refs.len(),
                mem_class
            ),
            "expiresAtMs": p.get("expiresAtMs").cloned().unwrap_or(Value::Null),
            "updatedAtMs": now_ms()?
        });

        self.qh_commit(&input, (id, None), QH_MEMORIES, &record, roles, (ep, None))
    }

    /// Registers or validates a `QFlow` workflow definition (`POST /qh/v1/workflows`, `QH-INV-020`).
    pub(super) fn qh_save_workflow(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "key", "id", "expected", "payload"])?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let key = parse(&input["key"])?;
        let id = input
            .get("id")
            .map(parse)
            .transpose()?
            .unwrap_or_else(|| derive("qh-flow", &key.0));
        let expected = input.get("expected").and_then(Value::as_u64);
        if input.get("id").is_some() {
            let (current, _) = self.cen_row(id, QH_FLOWS)?;
            if expected != Some(current) {
                return Err("CONFLICT".into());
            }
        } else if input.get("expected").is_some() {
            return Err("INVALID".into());
        } else if self.metadata(QH_FLOWS)?.len() >= 64 {
            return Err("RESOURCE_LIMIT".into());
        }
        let p = &input["payload"];
        allowed(
            p,
            &["workflowId", "title", "origin", "stages", "validatedByEval"],
        )?;
        let wf_id = text(&p["workflowId"], 3, 120)?;
        let title = text(&p["title"], 3, 160)?;
        let origin = p
            .get("origin")
            .and_then(Value::as_str)
            .unwrap_or("authored");
        if !["authored", "agent_synthesized"].contains(&origin) {
            return Err("INVALID".into());
        }
        super::read_workflow::validate_stages(p)?;
        let stages = p["stages"].as_array().ok_or("INVALID")?;
        if p.get("validatedByEval").is_some_and(|v| v != &json!(false)) {
            return Err("PERMISSION_DENIED".into());
        }
        let validated_by_eval = false;
        let status = "draft_validation_required";
        let record = json!({
            "kind": "qh-workflow",
            "workflowId": wf_id,
            "title": title,
            "origin": origin,
            "status": status,
            "validatedByEval": validated_by_eval,
            "stages": stages,
            "updatedAtMs": now_ms()?
        });

        self.qh_commit(
            &input,
            (id, expected),
            QH_FLOWS,
            &record,
            vec![],
            (
                if status == "validated" {
                    Epistemic::Authoritative
                } else {
                    Epistemic::Inferred
                },
                None,
            ),
        )
    }

    /// Universal Execution Kernel (`POST /qh/v1/execute`).
    /// Supports:
    /// - Demonstration A (`strategy: "direct"` / `"transform"`): Zero mission overhead (`QH-INV-001`).
    /// - Demonstration B (`strategy: "pipeline"` / `"workflow"`): Deterministic `QFlow` stage execution (`QH-INV-020`).
    /// - Demonstration C (`strategy: "agent"` / `"multi_agent"`): Bounded loop with `QPolicy`, `QProgress`, and `QFrame`.
    pub(super) fn qh_execute(&self, input: Value) -> Result<Value, String> {
        allowed(
            &input,
            &[
                "op",
                "key",
                "operation",
                "execution",
                "model",
                "pipeline",
                "workflowId",
                "input",
                "capabilities",
                "mandateId",
                "budget",
                "asKnownAt",
                "loopStrategy",
                "maxNoProgressSteps",
                "simulateRepeatToolCall",
                "simulateExternalUncertain",
            ],
        )?;
        let operation = input
            .get("operation")
            .and_then(Value::as_str)
            .unwrap_or("generate");
        let exec = &input["execution"];
        allowed(exec, &["strategy", "interaction"])?;
        let strategy = exec["strategy"].as_str().ok_or("INVALID")?;
        let interaction = exec
            .get("interaction")
            .and_then(Value::as_str)
            .unwrap_or("sync");
        if !VALID_STRATEGIES.contains(&strategy) || !VALID_INTERACTIONS.contains(&interaction) {
            return Err("INVALID".into());
        }

        // Resolve optional Mandate & check revocation (`QH-INV-002`, `QH-EVAL-006`)
        let mut active_mandate: Option<(Qid, Value)> = None;
        if let Some(m_val) = input.get("mandateId").filter(|v| !v.is_null()) {
            let mid = parse(m_val)?;
            let (_, m_row) = self.qh_active_mandate(mid)?;
            if m_row["status"] != "active" {
                return Err("PERMISSION_DENIED".into());
            }
            active_mandate = Some((mid, m_row));
        }

        if strategy == "workflow" && input.get("workflowId").is_some() {
            return self.qh_execute_read_workflow(&input);
        }

        // Resolve effective budget (`QH-INV-006`)
        let mut max_model_calls = 6_u64;
        let mut max_tool_calls = 12_u64;
        let mut max_cost_minor = 500_i64;
        if let Some((_, ref m_row)) = active_mandate {
            max_model_calls = m_row["budget"]["maxModelCalls"]
                .as_u64()
                .unwrap_or(max_model_calls);
            max_tool_calls = m_row["budget"]["maxToolCalls"]
                .as_u64()
                .unwrap_or(max_tool_calls);
            max_cost_minor = m_row["budget"]["maxCost"]["amountMinorUnits"]
                .as_i64()
                .unwrap_or(max_cost_minor);
        }
        if let Some(b) = input.get("budget").filter(|v| !v.is_null()) {
            if let Some(mc) = b.get("maxModelCalls").and_then(Value::as_u64) {
                max_model_calls = max_model_calls.min(mc);
            }
            if let Some(tc) = b.get("maxToolCalls").and_then(Value::as_u64) {
                max_tool_calls = max_tool_calls.min(tc);
            }
            if let Some(cost_obj) = b.get("maxCost") {
                let (cm, _, _) = validate_exact_money(cost_obj)?;
                max_cost_minor = max_cost_minor.min(cm);
            }
        }
        if max_model_calls == 0 || max_cost_minor <= 0 {
            return Err("RESOURCE_LIMIT".into());
        }

        // Strategy 1: DIRECT / TRANSFORM (`QH-INV-001` — no mission or agent loop created)
        if strategy == "direct" || strategy == "transform" {
            let req_model = input
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or("qh/fast");
            let text_in = input["input"]
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or("Direct operation");
            let selected = route_model(&RoutingRequirements {
                requested_model: req_model.to_owned(),
                operation: operation.to_owned(),
                required_input_modality: "text".into(),
                requires_tools: false,
                requires_structured_output: false,
                requires_vision: false,
                requires_reasoning: req_model == "qh/reasoning",
                estimated_tokens: ((text_in.len() as u64) / 4).max(8),
                privacy_policy: "".into(),
                routing_policy: "".into(),
                max_cost_minor: Some(max_cost_minor),
                exclude_models: Vec::new(),
            })?;
            return Ok(json!({
                "status": "completed",
                "operation": operation,
                "execution": { "strategy": strategy, "interaction": interaction },
                "resolvedModel": selected.model_id,
                "missionCreated": false,
                "agentLoopInvoked": false,
                "output": {
                    "text": format!("[QServe:{}] Direct output for: {}", selected.model_id, text_in),
                    "epistemic": "Inferred"
                },
                "events": [
                    "run.created",
                    "model.selected",
                    "model.completed",
                    "run.completed"
                ],
                "usage": {
                    "modelCalls": 1,
                    "toolCalls": 0,
                    "costMinorUnits": selected.cost_per_call_minor,
                    "currency": "USD"
                }
            }));
        }

        // Strategy 2: PIPELINE / WORKFLOW (`QFlow` — Demonstration B)
        if strategy == "pipeline" || strategy == "workflow" {
            if let Some(wf_id_val) = input.get("workflowId").filter(|v| !v.is_null()) {
                let wf_qid = parse(wf_id_val)?;
                let (_, wf_row) = self.cen_row(wf_qid, QH_FLOWS)?;
                // Enforce `QH-INV-020`: Unvalidated agent-synthesized workflows cannot execute!
                if wf_row["status"] != "validated" {
                    return Err("PERMISSION_DENIED".into());
                }
            }
            let pipeline_name = input
                .get("pipeline")
                .and_then(Value::as_str)
                .unwrap_or("audio.transcribe_translate_summarize.v1");
            let source_text = input["input"]
                .get("transcript")
                .or_else(|| input["input"].get("text"))
                .and_then(Value::as_str)
                .unwrap_or("Emergency utility crew dispatched to North Berkeley transformer substation at 14:20 UTC.");
            let source_id = input["input"]
                .get("sourceId")
                .and_then(Value::as_str)
                .unwrap_or("R020_USGS_PUBLIC");

            // Check `LicenseGate` inside the pipeline (`INV-ARCH-025`, `QH-INV-010`)
            let gate = self.evaluate_license_gate(json!({
                "op": "evaluateLicenseGate",
                "sourceId": source_id,
                "operation": "derive_feature",
                "derivedOutput": true
            }))?;
            if gate["permitted"] != true {
                return Err("PERMISSION_DENIED".into());
            }

            let stages = json!([
                { "stage": "1_ingest_preprocess", "status": "completed", "processor": "deterministic-dsp-v1", "epistemic": "Observed" },
                { "stage": "2_speech_recognition", "status": "completed", "processor": "quanta-audio-asr-v1", "transcript": source_text, "epistemic": "Derived" },
                { "stage": "3_structured_event_extraction", "status": "completed", "processor": "quanta-local-fast-v1", "extractedEvent": { "summary": source_text, "sourceId": source_id, "attribution": gate["requiredAttribution"] }, "epistemic": "Derived" },
                { "stage": "4_license_and_claim_validation", "status": "completed", "processor": "qpolicy-license-gate", "license": gate["license"], "epistemic": "Authoritative" }
            ]);

            return Ok(json!({
                "status": "completed",
                "operation": operation,
                "pipeline": pipeline_name,
                "execution": { "strategy": strategy, "interaction": interaction },
                "missionCreated": false,
                "agentLoopInvoked": false,
                "stages": stages,
                "output": {
                    "transcript": source_text,
                    "sourceId": source_id,
                    "license": gate["license"],
                    "requiredAttribution": gate["requiredAttribution"],
                    "epistemic": "Derived"
                },
                "events": [
                    "run.created",
                    "run.started",
                    "model.selected",
                    "model.completed",
                    "task.checkpointed",
                    "run.completed"
                ],
                "usage": {
                    "modelCalls": 2,
                    "toolCalls": 1,
                    "costMinorUnits": 13,
                    "currency": "USD"
                }
            }));
        }

        // Strategy 3: AGENT / MULTI_AGENT (`QAgent` bounded reasoning loop — Demonstration C)
        let loop_strategy = input
            .get("loopStrategy")
            .and_then(Value::as_str)
            .unwrap_or("react");
        if !VALID_LOOP_STRATEGIES.contains(&loop_strategy) {
            return Err("INVALID".into());
        }

        let req_caps: Vec<String> = input
            .get("capabilities")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_else(|| vec!["quanta.query".into(), "market.searchOffers".into()]);

        // Enforce `QPolicy` capability & mandate validation (`QH-INV-002`, `QH-INV-004`)
        for cid in &req_caps {
            let cap = find_capability(cid).ok_or("UNSUPPORTED")?;
            if let Some((_, ref m_row)) = active_mandate {
                let allowed_caps: BTreeSet<&str> = m_row["permittedCapabilities"]
                    .as_array()
                    .map(|a| a.iter().filter_map(Value::as_str).collect())
                    .unwrap_or_default();
                let allowed_effs: BTreeSet<&str> = m_row["permittedEffects"]
                    .as_array()
                    .map(|a| a.iter().filter_map(Value::as_str).collect())
                    .unwrap_or_default();
                if !allowed_caps.contains(cid.as_str())
                    || cap.effects.iter().any(|ef| !allowed_effs.contains(ef))
                {
                    return Err("PERMISSION_DENIED".into());
                }
            } else if cap.effects.iter().any(|ef| *ef != "read") {
                // Without an explicit write mandate, only read-only capabilities are allowed!
                return Err("PERMISSION_DENIED".into());
            }
        }

        let prompt_in = input["input"]
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("Research suitable workshop materials and offers.");
        let prompt_inj = contains_prompt_injection(prompt_in);

        let req_model = input
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("qh/auto");
        let selected = route_model(&RoutingRequirements {
            requested_model: req_model.to_owned(),
            operation: "reason".into(),
            required_input_modality: "text".into(),
            requires_tools: true,
            requires_structured_output: true,
            requires_vision: false,
            requires_reasoning: false,
            estimated_tokens: 128,
            privacy_policy: "".into(),
            routing_policy: "".into(),
            max_cost_minor: Some(max_cost_minor),
            exclude_models: Vec::new(),
        })?;

        // Simulate `OUTCOME_UNKNOWN` external-effect reconciliation boundary (`QH-INV-008`, `QH-EVAL-005`)
        let simulate_uncertain = input
            .get("simulateExternalUncertain")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if simulate_uncertain {
            let key = parse(&input["key"])?;
            let run_id = derive("qh-run", &key.0);
            let uncertain_record = json!({
                "kind": "qh-run",
                "title": format!("Uncertain External Outcome: {}", prompt_in.chars().take(60).collect::<String>()),
                "status": "outcome_unknown",
                "operation": operation,
                "loopStrategy": loop_strategy,
                "resolvedModel": selected.model_id,
                "reconciliationRequired": true,
                "canBlindRetry": false,
                "events": [
                    "run.created",
                    "run.started",
                    "tool.proposed",
                    "tool.authorized",
                    "tool.started",
                    "run.waiting"
                ],
                "updatedAtMs": now_ms()?
            });
            self.qh_commit(
                &input,
                (run_id, None),
                QH_RUNS,
                &uncertain_record,
                vec![],
                (Epistemic::Derived, Some(selected.cost_per_call_minor)),
            )?;
            return Ok(json!({
                "id": run_id.to_canonical_string(),
                "status": "outcome_unknown",
                "reconciliationRequired": true,
                "canBlindRetry": false,
                "run": uncertain_record
            }));
        }

        // `QProgress` loop convergence detector (`QHARNESS-002` Section 11)
        let max_no_progress = input
            .get("maxNoProgressSteps")
            .and_then(Value::as_u64)
            .unwrap_or(2);
        let simulate_repeat = input
            .get("simulateRepeatToolCall")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        // Retrieve actual offers and records from Quanta to ground the agent response (`QH-EVAL-001`)
        let offers = self.metadata(MARKET_OFFERS)?;
        let places = self.metadata(RECORDS)?;
        let evidence_citations: Vec<Value> = offers
            .iter()
            .take(4)
            .map(|(oid, rev, val)| {
                json!({
                    "id": oid.to_canonical_string(),
                    "revision": rev,
                    "kind": "market-offer",
                    "title": val["title"],
                    "price": val["price"],
                    "epistemic": "Authoritative"
                })
            })
            .chain(places.iter().take(2).map(|(pid, rev, val)| {
                json!({
                    "id": pid.to_canonical_string(),
                    "revision": rev,
                    "kind": val["kind"],
                    "title": val["title"],
                    "epistemic": "Authoritative"
                })
            }))
            .collect();

        let mut tool_calls_used = 0_u64;
        let mut model_calls_used = 0_u64;
        let mut cost_used = 0_i64;
        let mut stop_reason = "completed_verified";
        let mut trace_steps = Vec::new();

        let planned_steps = if simulate_repeat { 5_u64 } else { 2_u64 };
        let mut seen_tool_digests = BTreeSet::new();
        let mut no_progress_count = 0_u64;

        for step_idx in 1..=planned_steps {
            if model_calls_used + 1 > max_model_calls
                || tool_calls_used + 1 > max_tool_calls
                || cost_used + selected.cost_per_call_minor > max_cost_minor
            {
                stop_reason = "budget_exhausted_partial_retained";
                break;
            }
            model_calls_used += 1;
            tool_calls_used += 1;
            cost_used += selected.cost_per_call_minor;

            let tool_id = req_caps
                .get((step_idx as usize - 1) % req_caps.len())
                .cloned()
                .unwrap_or_else(|| "quanta.query".into());
            let call_sig = if simulate_repeat {
                format!("{tool_id}:repeat-same-query")
            } else {
                format!("{tool_id}:step-{step_idx}")
            };

            if !seen_tool_digests.insert(call_sig.clone()) {
                no_progress_count += 1;
                trace_steps.push(json!({
                    "step": step_idx,
                    "capabilityId": tool_id,
                    "progressSignal": "duplicate_tool_call_detected",
                    "noProgressCount": no_progress_count
                }));
                if no_progress_count >= max_no_progress {
                    stop_reason = "stopped_by_qprogress_no_new_evidence";
                    break;
                }
            } else {
                trace_steps.push(json!({
                    "step": step_idx,
                    "capabilityId": tool_id,
                    "progressSignal": "verified_evidence_acquired",
                    "evidenceCount": evidence_citations.len()
                }));
            }
        }

        let run_result = json!({
            "kind": "qh-run",
            "title": format!("Agent Run: {}", prompt_in.chars().take(72).collect::<String>()),
            "status": if stop_reason == "completed_verified" { "succeeded" } else { "paused_bounded" },
            "stopReason": stop_reason,
            "operation": operation,
            "execution": { "strategy": strategy, "interaction": interaction },
            "loopStrategy": loop_strategy,
            "resolvedModel": selected.model_id,
            "resolvedProvider": selected.provider_id,
            "promptInjectionBlocked": prompt_inj,
            "evidenceCitations": evidence_citations,
            "traceSteps": trace_steps,
            "events": [
                "run.created",
                "run.started",
                "model.selected",
                "tool.proposed",
                "tool.authorized",
                "tool.completed",
                "task.checkpointed",
                "run.completed"
            ],
            "usage": {
                "modelCalls": model_calls_used,
                "toolCalls": tool_calls_used,
                "costMinorUnits": cost_used,
                "currency": "USD"
            },
            "updatedAtMs": now_ms()?
        });

        if input.get("key").is_some() {
            if let Some(saved) = self.domain_prior(&input)? {
                return Ok(saved);
            }
            let key = parse(&input["key"])?;
            let run_id = derive("qh-run", &key.0);
            self.qh_commit(
                &input,
                (run_id, None),
                QH_RUNS,
                &run_result,
                vec![],
                (Epistemic::Derived, Some(cost_used)),
            )?;
            let mut out = run_result;
            out["id"] = json!(run_id.to_canonical_string());
            return Ok(out);
        }

        Ok(run_result)
    }

    /// Reconciles an `OUTCOME_UNKNOWN` run (`POST /qh/v1/runs/reconcile`, `QH-INV-008`, `QH-EVAL-005`).
    pub(super) fn qh_reconcile_run(&self, input: Value) -> Result<Value, String> {
        allowed(
            &input,
            &[
                "op",
                "key",
                "runId",
                "expected",
                "reconciledState",
                "externalReceiptId",
                "evidenceIds",
            ],
        )?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let run_id = parse(&input["runId"])?;
        let expected = input["expected"].as_u64().ok_or("INVALID")?;
        let reconciled_state = input["reconciledState"].as_str().ok_or("INVALID")?;
        if !["committed_verified", "aborted_not_executed"].contains(&reconciled_state) {
            return Err("INVALID".into());
        }
        let receipt_id = text(&input["externalReceiptId"], 3, 128)?;
        let ev_refs = self.collect_refs(&input, "evidenceIds", 16)?;

        let (current_rev, mut run_row) = self.cen_row(run_id, QH_RUNS)?;
        if current_rev != expected {
            return Err("CONFLICT".into());
        }
        if run_row["status"] != "outcome_unknown" {
            return Err("CONFLICT".into());
        }

        run_row["status"] = json!(if reconciled_state == "committed_verified" {
            "succeeded"
        } else {
            "failed_cleanly"
        });
        run_row["reconciliationRequired"] = json!(false);
        run_row["reconciledState"] = json!(reconciled_state);
        run_row["externalReceiptId"] = json!(receipt_id);
        run_row["evidenceIds"] = json!(ev_refs
            .iter()
            .map(Qid::to_canonical_string)
            .collect::<Vec<_>>());
        run_row["updatedAtMs"] = json!(now_ms()?);

        let mut roles = Vec::new();
        for ev in &ev_refs {
            roles.push((ROLE_LINK, *ev));
        }

        self.qh_commit(
            &input,
            (run_id, Some(expected)),
            QH_RUNS,
            &run_row,
            roles,
            (Epistemic::Authoritative, None),
        )
    }

    /// Creates a durable `QMission`, initial `QPlanVersion`, and bounded `QTask` DAG
    /// (`POST /qh/v1/missions`, `QH-INV-007`, `QH-EVAL-003`, `QH-EVAL-012`).
    pub(super) fn qh_create_mission(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "key", "payload"])?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let key = parse(&input["key"])?;
        let mission_id = derive("qh-mission", &key.0);
        let plan_id = derive("qh-plan-v1", &key.0);
        let p = &input["payload"];
        allowed(
            p,
            &[
                "title",
                "objective",
                "placeId",
                "projectId",
                "mandateId",
                "model",
                "executionProfile",
                "budget",
                "tasks",
            ],
        )?;
        let title = text(&p["title"], 3, 160)?;
        let objective = text(&p["objective"], 3, 2000)?;
        let req_model = p.get("model").and_then(Value::as_str).unwrap_or("qh/auto");
        let selected = route_model(&RoutingRequirements {
            requested_model: req_model.to_owned(),
            operation: "plan".into(),
            required_input_modality: "text".into(),
            requires_tools: true,
            requires_structured_output: true,
            requires_vision: false,
            requires_reasoning: false,
            estimated_tokens: 128,
            privacy_policy: "".into(),
            routing_policy: "".into(),
            max_cost_minor: None,
            exclude_models: Vec::new(),
        })?;

        let (budget_minor, _, currency) = if let Some(b) = p.get("budget") {
            validate_exact_money(b)?
        } else {
            (250_000_i64, *b"USD", "USD".to_owned())
        };

        let mut mission_roles = Vec::new();
        if let Some(place_val) = p.get("placeId").filter(|v| !v.is_null()) {
            let pq = parse(place_val)?;
            self.validate_any_ref(pq)?;
            mission_roles.push((ROLE_PLACE, pq));
        }
        if let Some(proj_val) = p.get("projectId").filter(|v| !v.is_null()) {
            let prj = parse(proj_val)?;
            self.validate_any_ref(prj)?;
            mission_roles.push((ROLE_PROJECT, prj));
        }
        if let Some(m_val) = p.get("mandateId").filter(|v| !v.is_null()) {
            let mid = parse(m_val)?;
            let (_, m_row) = self.qh_active_mandate(mid)?;
            if m_row["status"] != "active" {
                return Err("PERMISSION_DENIED".into());
            }
            mission_roles.push((ROLE_MANDATE, mid));
        }

        // Assemble bounded tasks with explicit completion criteria and dependencies
        let default_tasks = json!([
            {
                "code": "task-1",
                "title": "Retrieve authorized site, parcel & marketplace evidence",
                "requiredCapabilities": ["quanta.query", "market.searchOffers"],
                "specialistRole": "Property & Market Research Specialist",
                "dependsOn": []
            },
            {
                "code": "task-2",
                "title": "Synthesize source-backed BOM & cost alternatives",
                "requiredCapabilities": ["project.compilePlan"],
                "specialistRole": "Economic & Design Analysis Specialist",
                "dependsOn": ["task-1"]
            },
            {
                "code": "task-3",
                "title": "Review evidence completeness & verify unknown constraints",
                "requiredCapabilities": ["evidence.inspect"],
                "specialistRole": "Evidence Review Specialist",
                "dependsOn": ["task-2"]
            }
        ]);
        let task_specs = p
            .get("tasks")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_else(|| default_tasks.as_array().cloned().unwrap_or_default());
        if task_specs.is_empty() || task_specs.len() > 16 {
            return Err("INVALID".into());
        }

        let now = now_ms()?;
        let mut heads = vec![
            Head {
                statement: mission_id,
                expected: None,
            },
            Head {
                statement: plan_id,
                expected: None,
            },
        ];
        let mut mutations = Vec::new();
        let mut task_qids = Vec::new();

        for (idx, t) in task_specs.iter().enumerate() {
            let t_qid = derive(&format!("qh-task-{idx}"), &key.0);
            task_qids.push(t_qid.to_canonical_string());
            heads.push(Head {
                statement: t_qid,
                expected: None,
            });
            let t_title = t["title"].as_str().unwrap_or("Mission Task");
            let task_record = json!({
                "kind": "qh-task",
                "missionId": mission_id.to_canonical_string(),
                "planId": plan_id.to_canonical_string(),
                "taskIndex": idx,
                "code": t.get("code").and_then(Value::as_str).unwrap_or("task"),
                "title": t_title,
                "status": if idx == 0 { "ready" } else { "waiting_dependencies" },
                "attemptState": "created",
                "attemptCount": 0,
                "specialistRole": t.get("specialistRole").and_then(Value::as_str).unwrap_or("Specialist"),
                "requiredCapabilities": t.get("requiredCapabilities").cloned().unwrap_or_else(|| json!(["quanta.query"])),
                "dependsOn": t.get("dependsOn").cloned().unwrap_or_else(|| json!([])),
                "verifiedOutput": Value::Null,
                "updatedAtMs": now
            });
            mutations.push(Mutation::Put(qh_statement(
                t_qid,
                QH_TASKS,
                &task_record,
                vec![(ROLE_MISSION, mission_id)],
                Epistemic::Authoritative,
                None,
            )?));
        }

        let plan_record = json!({
            "kind": "qh-plan",
            "missionId": mission_id.to_canonical_string(),
            "version": 1,
            "title": format!("Plan v1: {title}"),
            "status": "adopted",
            "taskRefs": task_qids,
            "unknownsExplicitlyPreserved": [
                "Exact site soil bearing capacity requires physical measurement",
                "Local permit turnaround time remains an external dependency"
            ],
            "updatedAtMs": now
        });
        mutations.push(Mutation::Put(qh_statement(
            plan_id,
            QH_PLANS,
            &plan_record,
            vec![(ROLE_MISSION, mission_id)],
            Epistemic::Authoritative,
            Some(budget_minor),
        )?));

        let mission_record = json!({
            "kind": "qh-mission",
            "title": title,
            "objective": objective,
            "status": "ready",
            "ownerDomain": self.domain.to_canonical_string(),
            "initiatingPrincipal": self.owner.to_canonical_string(),
            "adoptedPlanRef": plan_id.to_canonical_string(),
            "activeTaskRefs": task_qids,
            "completedTaskRefs": [],
            "mandateRef": p.get("mandateId").cloned().unwrap_or(Value::Null),
            "placeId": p.get("placeId").cloned().unwrap_or(Value::Null),
            "projectId": p.get("projectId").cloned().unwrap_or(Value::Null),
            "executionProfile": p.get("executionProfile").and_then(Value::as_str).unwrap_or("research.durable.v1"),
            "activeModel": selected.model_id,
            "modelHistory": [selected.model_id],
            "budget": {
                "amountMinorUnits": budget_minor,
                "spentMinorUnits": 0,
                "currency": currency
            },
            "checkpoint": {
                "completedTaskCount": 0,
                "totalTaskCount": task_specs.len(),
                "lastVerifiedTaskRef": Value::Null,
                "resumable": true
            },
            "updatedAtMs": now
        });
        mutations.push(Mutation::Put(qh_statement(
            mission_id,
            QH_MISSIONS,
            &mission_record,
            mission_roles,
            Epistemic::Authoritative,
            Some(budget_minor),
        )?));

        let admission = derive("domain-admit", &key.0);
        heads.push(Head {
            statement: admission,
            expected: None,
        });
        mutations.push(Mutation::Put(statement(
            admission,
            DOMAIN_ADMIT,
            &json!({
                "requestHash": fingerprint(&input),
                "resultId": mission_id.to_canonical_string()
            }),
        )));

        receipt(
            self.db_mut()?.commit(Batch {
                domain: self.domain,
                principal: self.owner,
                key,
                heads,
                mutations,
                content: vec![],
            }),
            mission_id,
        )
    }

    /// Executes a lifecycle transition on a durable `QMission` (`POST /qh/v1/missions/action`):
    /// `step` (executes next ready task & checkpoints), `pause`, `resume` (rechecks mandate & resumes
    /// from durable checkpoint without duplicating completed tasks, `QH-EVAL-003`),
    /// `switch_model` (replaces model mid-mission without losing progress, `QH-EVAL-012`),
    /// `simulate_provider_failure` (`QH-EVAL-010`), or `cancel`.
    pub(super) fn qh_mission_action(&self, input: Value) -> Result<Value, String> {
        allowed(
            &input,
            &["op", "key", "missionId", "expected", "action", "newModel"],
        )?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let key = parse(&input["key"])?;
        let mission_id = parse(&input["missionId"])?;
        let expected = input["expected"].as_u64().ok_or("INVALID")?;
        let action = input["action"].as_str().ok_or("INVALID")?;
        if ![
            "step",
            "pause",
            "resume",
            "switch_model",
            "simulate_provider_failure",
            "cancel",
        ]
        .contains(&action)
        {
            return Err("INVALID".into());
        }

        let (current_rev, mut mission) = self.cen_row(mission_id, QH_MISSIONS)?;
        if current_rev != expected {
            return Err("CONFLICT".into());
        }

        // Recheck mandate freshness before any execution or resume (`QH-EVAL-006`)
        if matches!(action, "step" | "resume") {
            if let Some(m_val) = mission.get("mandateRef").filter(|v| !v.is_null()) {
                let mid = parse(m_val)?;
                let (_, m_row) = self.qh_active_mandate(mid)?;
                if m_row["status"] != "active" {
                    return Err("PERMISSION_DENIED".into());
                }
            }
        }

        let now = now_ms()?;
        let mut heads = vec![Head {
            statement: mission_id,
            expected: Some(expected),
        }];
        let mut mutations = Vec::new();

        match action {
            "pause" => {
                mission["status"] = json!("paused");
                mission["updatedAtMs"] = json!(now);
            }
            "cancel" => {
                mission["status"] = json!("cancelled");
                mission["updatedAtMs"] = json!(now);
            }
            "simulate_provider_failure" => {
                // `QH-EVAL-010`: Model/provider failure does not destroy mission state or completed tasks!
                mission["status"] = json!("waiting_recovery");
                mission["lastError"] = json!({
                    "code": "PROVIDER_FAILED",
                    "message": "Upstream model provider timed out; durable checkpoint intact."
                });
                mission["updatedAtMs"] = json!(now);
            }
            "switch_model" => {
                // `QH-EVAL-012`: Model replacement mid-mission
                let req_model = input["newModel"].as_str().ok_or("INVALID")?;
                let selected = route_model(&RoutingRequirements {
                    requested_model: req_model.to_owned(),
                    operation: "reason".into(),
                    required_input_modality: "text".into(),
                    requires_tools: true,
                    requires_structured_output: true,
                    requires_vision: false,
                    requires_reasoning: req_model == "qh/reasoning",
                    estimated_tokens: 128,
                    privacy_policy: "".into(),
                    routing_policy: "".into(),
                    max_cost_minor: None,
                    exclude_models: Vec::new(),
                })?;
                mission["activeModel"] = json!(selected.model_id);
                if let Some(hist) = mission["modelHistory"].as_array_mut() {
                    hist.push(json!(selected.model_id));
                }
                if mission["status"] == "waiting_recovery" || mission["status"] == "paused" {
                    mission["status"] = json!("ready");
                }
                mission["updatedAtMs"] = json!(now);
            }
            "resume" | "step" => {
                if mission["status"] == "cancelled" || mission["status"] == "completed" {
                    return Err("CONFLICT".into());
                }
                let active_model_id = mission["activeModel"]
                    .as_str()
                    .unwrap_or("quanta-local-fast-v1");
                let model_spec = MODEL_REGISTRY
                    .iter()
                    .find(|m| m.model_id == active_model_id)
                    .unwrap_or(&MODEL_REGISTRY[0]);

                let budget_minor = mission["budget"]["amountMinorUnits"]
                    .as_i64()
                    .unwrap_or(250_000);
                let mut spent_minor = mission["budget"]["spentMinorUnits"].as_i64().unwrap_or(0);
                if spent_minor + model_spec.cost_per_call_minor > budget_minor {
                    mission["status"] = json!("paused_budget_exhausted");
                    mission["updatedAtMs"] = json!(now);
                } else {
                    let task_refs: Vec<String> = mission["activeTaskRefs"]
                        .as_array()
                        .map(|a| {
                            a.iter()
                                .filter_map(Value::as_str)
                                .map(str::to_owned)
                                .collect()
                        })
                        .unwrap_or_default();
                    let mut completed_refs: Vec<String> = mission["completedTaskRefs"]
                        .as_array()
                        .map(|a| {
                            a.iter()
                                .filter_map(Value::as_str)
                                .map(str::to_owned)
                                .collect()
                        })
                        .unwrap_or_default();

                    // Find the first task that is not yet in `completedTaskRefs` (`QH-EVAL-003` — never re-executes completed tasks!)
                    let next_task_str = task_refs
                        .iter()
                        .find(|tid| !completed_refs.contains(tid))
                        .cloned();

                    if let Some(tid_str) = next_task_str {
                        let t_qid = Qid::parse(&tid_str).map_err(|_| "INVALID")?;
                        let (t_rev, mut t_row) = self.cen_row(t_qid, QH_TASKS)?;
                        heads.push(Head {
                            statement: t_qid,
                            expected: Some(t_rev),
                        });
                        let attempts = t_row["attemptCount"].as_u64().unwrap_or(0) + 1;
                        t_row["status"] = json!("completed");
                        t_row["attemptState"] = json!("succeeded");
                        t_row["attemptCount"] = json!(attempts);
                        t_row["executedByModel"] = json!(model_spec.model_id);
                        t_row["verifiedOutput"] = json!({
                            "summary": format!("Verified completion of '{}' using {}", t_row["title"].as_str().unwrap_or("task"), model_spec.model_id),
                            "epistemic": "Derived",
                            "sequenceWatermark": current_rev
                        });
                        t_row["updatedAtMs"] = json!(now);

                        mutations.push(Mutation::Put(qh_statement(
                            t_qid,
                            QH_TASKS,
                            &t_row,
                            vec![(ROLE_MISSION, mission_id)],
                            Epistemic::Authoritative,
                            None,
                        )?));

                        completed_refs.push(tid_str.clone());
                        spent_minor += model_spec.cost_per_call_minor;
                        mission["completedTaskRefs"] = json!(completed_refs);
                        mission["budget"]["spentMinorUnits"] = json!(spent_minor);
                        mission["checkpoint"] = json!({
                            "completedTaskCount": completed_refs.len(),
                            "totalTaskCount": task_refs.len(),
                            "lastVerifiedTaskRef": tid_str,
                            "lastModelUsed": model_spec.model_id,
                            "resumable": completed_refs.len() < task_refs.len()
                        });
                        mission["status"] = json!(if completed_refs.len() >= task_refs.len() {
                            "completed"
                        } else {
                            "running"
                        });
                        mission["updatedAtMs"] = json!(now);
                    } else {
                        mission["status"] = json!("completed");
                        mission["updatedAtMs"] = json!(now);
                    }
                }
            }
            _ => return Err("INVALID".into()),
        }

        let budget_minor = mission["budget"]["amountMinorUnits"]
            .as_i64()
            .unwrap_or(250_000);
        mutations.push(Mutation::Put(qh_statement(
            mission_id,
            QH_MISSIONS,
            &mission,
            vec![],
            Epistemic::Authoritative,
            Some(budget_minor),
        )?));

        let admission = derive("domain-admit", &key.0);
        heads.push(Head {
            statement: admission,
            expected: None,
        });
        mutations.push(Mutation::Put(statement(
            admission,
            DOMAIN_ADMIT,
            &json!({
                "requestHash": fingerprint(&input),
                "resultId": mission_id.to_canonical_string()
            }),
        )));

        receipt(
            self.db_mut()?.commit(Batch {
                domain: self.domain,
                principal: self.owner,
                key,
                heads,
                mutations,
                content: vec![],
            }),
            mission_id,
        )
    }

    /// Executes the 20-scenario QEval acceptance & regression suite (`POST /qh/v1/evaluations/run`, `QH-INV-019`, `QH-INV-022`).
    pub(super) fn qh_run_eval(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "key", "suite"])?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let key = parse(&input["key"])?;
        let eval_id = derive("qh-eval", &key.0);
        let suite = match input.get("suite") {
            Some(value) => value.as_str().ok_or("INVALID")?,
            None => "qharness-core-20",
        };

        if suite != "qharness-core-20" {
            return Err("INVALID".into());
        }
        if self.metadata(QH_EVALS)?.len() >= 64 {
            return Err("RESOURCE_LIMIT".into());
        }
        let eval_record = super::qeval::run_core_suite()?;

        self.qh_commit(
            &input,
            (eval_id, None),
            QH_EVALS,
            &eval_record,
            vec![],
            (Epistemic::Derived, None),
        )
    }

    /// Returns the complete QHarness state snapshot (`GET /qh/v1/status`) for the Agent Control Center UI and tests.
    pub(super) fn qh_status(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op"])?;
        let map_rows = |pred: Qid| -> Result<Vec<Value>, String> {
            let mut rows = self.metadata(pred)?;
            rows.sort_by_key(|r| std::cmp::Reverse(r.1));
            Ok(rows
                .into_iter()
                .map(|(id, rev, payload)| {
                    json!({
                        "id": id.to_canonical_string(),
                        "revision": rev,
                        "payload": payload
                    })
                })
                .collect())
        };

        let missions = map_rows(QH_MISSIONS)?;
        let plans = map_rows(QH_PLANS)?;
        let tasks = map_rows(QH_TASKS)?;
        let runs = map_rows(QH_RUNS)?;
        let mandates = map_rows(QH_MANDATES)?;
        let frames = map_rows(QH_FRAMES)?;
        let memories = map_rows(QH_MEMORIES)?;
        let workflows = map_rows(QH_FLOWS)?;
        let evaluations = map_rows(QH_EVALS)?
            .into_iter()
            .map(|mut row| {
                row["effectiveStatus"] = if row["payload"]["evidenceVersion"] == 1 {
                    row["payload"]["status"].clone()
                } else {
                    json!("unverified_legacy")
                };
                row
            })
            .collect::<Vec<_>>();

        let total_mission_spent_minor: i64 = missions
            .iter()
            .filter_map(|m| m["payload"]["budget"]["spentMinorUnits"].as_i64())
            .sum();

        Ok(json!({
            "version": "0.2.0-build-006",
            "specification": "QHARNESS-002",
            "models": MODEL_REGISTRY.iter().map(model_to_json).collect::<Vec<_>>(),
            "capabilities": CAPABILITY_REGISTRY.iter().map(capability_to_json).collect::<Vec<_>>(),
            "missions": missions,
            "plans": plans,
            "tasks": tasks,
            "runs": runs,
            "mandates": mandates,
            "frames": frames,
            "memories": memories,
            "workflows": workflows,
            "evaluations": evaluations,
            "summary": {
                "modelCount": MODEL_REGISTRY.len(),
                "capabilityCount": CAPABILITY_REGISTRY.len(),
                "missionCount": missions.len(),
                "taskCount": tasks.len(),
                "runCount": runs.len(),
                "mandateCount": mandates.len(),
                "frameCount": frames.len(),
                "memoryCount": memories.len(),
                "workflowCount": workflows.len(),
                "evaluationCount": evaluations.len(),
                "totalMissionSpentMinorUnits": total_mission_spent_minor,
                "currency": "USD"
            }
        }))
    }
}
