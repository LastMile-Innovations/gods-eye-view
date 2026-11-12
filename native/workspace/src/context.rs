//! Scoped, bounded native context; no external model disclosure is inferred from read access.
use super::*;
use super::citizen::{now_ms, text};
use super::domain::{MARKET_OFFERS, PROJECTS, ROLE_LINK};
use super::lifecycle::fingerprint;
use super::qharness::{QH_FRAMES, contains_prompt_injection};
use std::collections::BTreeSet;
impl Workspace {
    /// Bounded native context. Registry license checks do not authorize external disclosure.
    pub(super) fn qh_compile_frame(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "key", "payload"])?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let key = parse(&input["key"])?;
        let frame_id = derive("qh-frame", &key.0);
        let p = &input["payload"];
        allowed(
            p,
            &[
                "objective",
                "purpose",
                "asKnownAt",
                "maxTokens",
                "mandateId",
                "candidateSourceIds",
                "operation",
            ],
        )?;
        let objective = text(&p["objective"], 3, 1000)?;
        let purpose = p
            .get("purpose")
            .and_then(Value::as_str)
            .unwrap_or("research");
        let target_op = p
            .get("operation")
            .and_then(Value::as_str)
            .unwrap_or("derive_feature");
        let requested_tokens = match p.get("maxTokens") {
            Some(v) => v.as_u64().filter(|n| (64..=131_072).contains(n)).ok_or("INVALID")?,
            None => 4096,
        };
        let mandate = match p.get("mandateId").filter(|v| !v.is_null()) {
            Some(v) => Some(self.qh_active_mandate(parse(v)?)?.1),
            None => None,
        };
        let mut max_tokens = requested_tokens;
        let mut resources = BTreeSet::new();
        if let Some(m) = &mandate {
            if !m["permittedCapabilities"].as_array().is_some_and(|a| a.contains(&json!("quanta.query")))
                || !m["permittedEffects"].as_array().is_some_and(|a| a.contains(&json!("read"))) {
                return Err("PERMISSION_DENIED".into());
            }
            max_tokens = max_tokens.min(m["budget"]["maxTokens"].as_u64().ok_or("PERMISSION_DENIED")?);
            for id in m["permittedResources"].as_array().ok_or("PERMISSION_DENIED")? {
                resources.insert(parse(id)?);
            }
        }
        // Conservative byte admission, not a claim of provider tokenizer measurement.
        let context_size = |evidence: &Vec<Value>| -> Result<usize, String> {
            serde_json::to_vec(&json!({"objective": objective,"evidence":evidence}))
                .map(|v| v.len()).map_err(|_| "NATIVE_UNAVAILABLE".into())
        };
        if context_size(&Vec::new())? as u64 > max_tokens { return Err("RESOURCE_LIMIT".into()); }
        let mut context_truncated = false;
        let db = self.db()?;
        let head_seq = db.domain_sequence(self.domain, self.owner).map_err(err)?;
        let cutoff = match p.get("asKnownAt") {
            Some(v) if !v.is_null() => v.as_u64().ok_or("INVALID")?,
            _ => head_seq,
        };
        if cutoff > head_seq {
            return Err("INVALID".into());
        }

        // Collect authorized records at or before `asKnownAt` sequence cutoff (`QH-EVAL-017`)
        let mut grounded_evidence = Vec::new();
        let mut roles = Vec::new();
        let mut injection_alerts = Vec::new();

        for (pred, label, ep) in [
            (RECORDS, "record", "Authoritative"),
            (MARKET_OFFERS, "market-offer", "Authoritative"),
            (PROJECTS, "project", "Authoritative"),
            (super::citizen::ARTIFACTS, "evidence-artifact", "Observed"),
            (super::citizen::CLAIMS, "evidence-claim", "Derived"),
        ] {
            let revs = db
                .query_current(
                    self.domain,
                    self.owner,
                    &Query {
                        predicate: Some(pred),
                        as_known_at: Some(cutoff),
                        ..Query::default()
                    },
                )
                .map_err(err)?;
            for rev in revs {
                if rev.sequence > cutoff {
                    continue;
                }
                let Some(st) = rev.statement else {
                    continue;
                };
                if !resources.is_empty() && !resources.contains(&st.id) { continue; }
                // A historical revision is never proof of current read permission.
                if db.revision_current(self.domain, self.owner, st.id, None).map_err(err)?
                    .and_then(|r| r.statement).is_none_or(|s| s.predicate != pred) { continue; }
                let raw_json = match st.value {
                    Native::Text(t) => Some(t),
                    Native::Map(mut m) => match m.remove("metadata") {
                        Some(Native::Text(t)) => Some(t),
                        _ => None,
                    },
                    _ => None,
                };
                let parsed = raw_json
                    .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                    .unwrap_or_else(|| json!({}));
                let title_str = parsed["title"].as_str().unwrap_or(label);
                let desc_str = parsed
                    .get("description")
                    .or_else(|| parsed.get("statement"))
                    .or_else(|| parsed.get("summary"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let untrusted_injection =
                    contains_prompt_injection(title_str) || contains_prompt_injection(desc_str);
                let handle = format!("ctx-{}", grounded_evidence.len() + 1);
                grounded_evidence.push(json!({
                    "handle": handle,
                    "id": st.id.to_canonical_string(),
                    "revision": rev.sequence,
                    "kind": parsed.get("kind").and_then(Value::as_str).unwrap_or(label),
                    "title": title_str,
                    "epistemic": ep,
                    "untrustedData": true,
                    "promptInjectionDetected": untrusted_injection,
                    "promptInjectionSanitized": false,
                }));
                if context_size(&grounded_evidence)? as u64 > max_tokens {
                    grounded_evidence.pop();
                    context_truncated = true;
                    continue;
                }
                roles.push((ROLE_LINK, st.id));
                if untrusted_injection { injection_alerts.push(st.id.to_canonical_string()); }
            }
        }
        drop(db);

        // Native world policy grants read for a local purpose, not model derivation or
        // third-party disclosure. Do not join caller registry names to unrelated source QIDs.
        let source_conflicts: Vec<Value> = Vec::new();

        // Evaluate `LicenseGate` on candidate external sources (`QH-INV-010`)
        let mut admitted_sources = Vec::new();
        let mut excluded_sources = Vec::new();
        if let Some(candidate) = p.get("candidateSourceIds") {
            let src_arr = candidate.as_array().filter(|a| a.len() <= 32).ok_or("INVALID")?;
            for s in src_arr {
                let sid = s.as_str().ok_or("INVALID")?;
                let gate = self.evaluate_license_gate(json!({
                    "op": "evaluateLicenseGate",
                    "sourceId": sid,
                    "operation": target_op,
                    "derivedOutput": true
                }))?;
                if gate["permitted"] == true {
                    admitted_sources.push(json!({
                        "sourceId": sid,
                        "license": gate["license"],
                        "requiredAttribution": gate["requiredAttribution"]
                    }));
                } else {
                    excluded_sources.push(json!({
                        "sourceId": sid,
                        "reason": gate["reason"],
                        "code": gate["code"]
                    }));
                }
            }
        }

        let record = json!({
            "kind": "qh-frame",
            "title": format!("QFrame: {}", objective.chars().take(72).collect::<String>()),
            "status": "compiled",
            "objective": objective,
            "purpose": purpose,
            "headSequence": head_seq,
            "asKnownAtSequence": cutoff,
            "isHistoricalContext": cutoff < head_seq,
            "maxTokens": max_tokens,
            "contextBudgetUnit": "conservative_utf8_bytes",
            "serializedContextBytes": context_size(&grounded_evidence)?,
            "measuredTokens": Value::Null,
            "contextTruncated": context_truncated,
            "externalOccurrencesIncluded": false,
            "externalContextStatus": "unavailable_source_operation_authority",
            "instructionTrust": "record_content_is_untrusted_data",

            "groundedEvidenceCount": grounded_evidence.len(),
            "groundedEvidence": grounded_evidence,
            "sourceConflicts": source_conflicts,
            "admittedSources": admitted_sources,
            "excludedSources": excluded_sources,
            "promptInjectionAlerts": injection_alerts,
            "contextDigest": fingerprint(&json!({
                "objective": objective,
                "cutoff": cutoff,
                "evidence": grounded_evidence
            })),
            "updatedAtMs": now_ms()?
        });

        let commit_res = self.qh_commit(
            &input,
            (frame_id, None),
            QH_FRAMES,
            &record,
            roles,
            (Epistemic::Derived, None),
        )?;

        Ok(json!({
            "status": "committed",
            "id": frame_id.to_canonical_string(),
            "sequence": commit_res["sequence"],
            "receipt": commit_res["receipt"],
            "frame": record
        }))
    }

}
