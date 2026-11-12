//! Local behavioral probes with explicit missing coverage. This is not model quality or release certification.
use super::citizen::now_ms;
use super::lifecycle::fingerprint;
use super::*;
use std::time::Instant;

fn key(n: u64) -> String {
    format!("{n:032x}")
}
fn write(n: u64, title: &str) -> Value {
    json!({"op":"write","key":key(n),"payload":{"kind":"need","title":title,"description":"Synthetic isolated evaluation fixture","status":"open","refs":[]}})
}
fn mandate(n: u64) -> Value {
    json!({"op":"qhCreateMandate","key":key(n),"payload":{"title":"Read fixture mandate","purpose":"Evaluate bounded native checks","permittedCapabilities":["quanta.query"],"permittedEffects":["read"],"budget":{"maxModelCalls":2,"maxToolCalls":4,"maxTokens":100,"maxWallTimeMs":1000,"maxCost":{"amountMinorUnits":50,"currency":"USD"},"maxDelegationDepth":2}}})
}
fn expect(observations: &mut Vec<Value>, name: &str, actual: Value, expected: Value) {
    observations
        .push(json!({"check":name,"passed":actual==expected,"actual":actual,"expected":expected}));
}
fn probe(index: usize, ws: &Workspace) -> Result<Vec<Value>, String> {
    let mut out = vec![];
    match index {
        4 => {
            let input = mandate(1);
            let first = ws.execute(input.clone())?;
            expect(
                &mut out,
                "exact_retry_receipt",
                ws.execute(input.clone())?,
                first,
            );
            let mut changed = input;
            changed["payload"]["title"] = json!("Conflicting request under same key");
            expect(
                &mut out,
                "conflicting_retry_refused",
                json!(ws.execute(changed).err()),
                json!("INVALID"),
            );
        }
        6 => {
            let parent = ws.execute(mandate(1))?;
            let mut cmd = mandate(2);
            cmd["payload"]["parentMandateId"] = parent["id"].clone();
            cmd["payload"]["budget"]["maxDelegationDepth"] = json!(1);
            let child = ws.execute(cmd)?;
            ws.execute(json!({"op":"qhRevokeMandate","key":key(3),"mandateId":parent["id"],"expected":parent["sequence"],"reason":"Revoke parent of delegated authority"}))?;
            expect(&mut out,"revoked_ancestor_blocks_frame",json!(ws.execute(json!({"op":"qhCompileFrame","key":key(4),"payload":{"objective":"Refuse revoked child authority","mandateId":child["id"]}})).err()),json!("PERMISSION_DENIED"));
        }
        11 => {
            let parent = ws.execute(mandate(1))?;
            for (n, field, value) in [
                (2, "maxTokens", json!(101)),
                (3, "maxWallTimeMs", json!(1001)),
                (
                    4,
                    "maxCost",
                    json!({"amountMinorUnits":50,"currency":"EUR"}),
                ),
            ] {
                let mut child = mandate(n);
                child["payload"]["parentMandateId"] = parent["id"].clone();
                child["payload"]["budget"]["maxDelegationDepth"] = json!(1);
                child["payload"]["budget"][field] = value;
                expect(
                    &mut out,
                    field,
                    json!(ws.execute(child).err()),
                    json!("PERMISSION_DENIED"),
                );
            }
        }
        14 => {
            expect(&mut out,"unknown_capability_refused",json!(ws.execute(json!({"op":"qhCapabilities","capabilityId":"unregistered.external.transfer"})).err()),json!("NOT_AVAILABLE"));
        }
        15 => {
            let saved = ws.execute(write(1, "Manual native workflow"))?;
            let snapshot = ws.execute(json!({"op":"snapshot"}))?;
            expect(
                &mut out,
                "manual_record_read",
                snapshot["items"][0]["id"].clone(),
                saved["id"].clone(),
            );
            expect(
                &mut out,
                "no_inference_mission",
                ws.execute(json!({"op":"qhStatus"}))?["summary"]["missionCount"].clone(),
                json!(0),
            );
        }
        16 | 17 => {
            let first = ws.execute(write(1, "Before historical cutoff"))?;
            ws.execute(write(2, "After historical cutoff"))?;
            let frame=ws.execute(json!({"op":"qhCompileFrame","key":key(3),"payload":{"objective":"Check actual revision lineage","asKnownAt":first["sequence"]}}))?["frame"].clone();
            expect(
                &mut out,
                "only_prior_revision",
                frame["groundedEvidenceCount"].clone(),
                json!(1),
            );
            expect(
                &mut out,
                "exact_source_revision",
                frame["groundedEvidence"][0]["revision"].clone(),
                first["sequence"].clone(),
            );
            expect(
                &mut out,
                "exact_source_identity",
                frame["groundedEvidence"][0]["id"].clone(),
                first["id"].clone(),
            );
            if index == 16 {
                expect(
                    &mut out,
                    "context_digest",
                    frame["contextDigest"].clone(),
                    json!(fingerprint(
                        &json!({"objective":"Check actual revision lineage","cutoff":first["sequence"],"evidence":frame["groundedEvidence"]})
                    )),
                );
            }
        }
        19 => {
            let first = ws.execute(write(1, "Original record"))?;
            let mut edit = write(2, "First editor");
            edit["id"] = first["id"].clone();
            edit["expected"] = first["sequence"].clone();
            ws.execute(edit)?;
            let mut stale = write(3, "Stale second editor");
            stale["id"] = first["id"].clone();
            stale["expected"] = first["sequence"].clone();
            expect(
                &mut out,
                "stale_head_refused",
                json!(ws.execute(stale).err()),
                json!("CONFLICT"),
            );
            expect(
                &mut out,
                "winner_preserved",
                ws.execute(json!({"op":"snapshot"}))?["items"][0]["payload"]["title"].clone(),
                json!("First editor"),
            );
        }
        20 => {
            let mut forged = json!({"op":"qhSaveWorkflow","key":key(1),"payload":{"workflowId":"fixture.overview.v1","title":"Fixture overview","origin":"agent_synthesized","validatedByEval":true,"stages":[{"id":"records","action":"quanta.query"}]}});
            expect(
                &mut out,
                "boolean_approval_refused",
                json!(ws.execute(forged.clone()).err()),
                json!("PERMISSION_DENIED"),
            );
            forged["payload"]["validatedByEval"] = json!(false);
            let saved = ws.execute(forged)?;
            let run = json!({"op":"qhExecute","operation":"execute","execution":{"strategy":"workflow","interaction":"sync"},"workflowId":saved["id"]});
            expect(
                &mut out,
                "unvalidated_definition_refused",
                json!(ws.execute(run.clone()).err()),
                json!("PERMISSION_DENIED"),
            );
            ws.execute(json!({"op":"qhValidateWorkflow","key":key(2),"workflowId":saved["id"],"expected":saved["sequence"]}))?;
            expect(
                &mut out,
                "actual_native_read_execution",
                ws.execute(run)?["executionMode"].clone(),
                json!("native_read_only"),
            );
        }
        _ => return Err("UNSUPPORTED".into()),
    }
    Ok(out)
}
const SCENARIOS: [(&str, Option<&str>); 20] = [
    (
        "Research and evidence citation",
        Some("No real model/provider research oracle is wired"),
    ),
    (
        "Typed model output schema",
        Some("General model schema validation is not implemented"),
    ),
    (
        "Crash-safe mission recovery",
        Some("A clean reopen is not process-crash/provider recovery evidence"),
    ),
    ("Exact native request retries", None),
    (
        "External-effect reconciliation",
        Some("No real external effect/provider reconciliation is exercised"),
    ),
    ("Mandate ancestor revocation", None),
    (
        "Untrusted-source injection resistance",
        Some("A substring detector does not prove adversarial immunity"),
    ),
    (
        "Domain and source-policy isolation",
        Some("Requires independent hosted/hostile-domain and revocation coverage"),
    ),
    (
        "Complete execution resource budgets",
        Some("Model token/wall-time and spend reservations remain incomplete"),
    ),
    (
        "Provider failure recovery",
        Some("No real model provider failure is exercised"),
    ),
    ("Delegated resource attenuation", None),
    (
        "Compatible model replacement",
        Some("Registry alias changes do not prove real model continuity"),
    ),
    (
        "Independent conflicting claims",
        Some("Requires source-conflict and independence fixtures beyond this suite"),
    ),
    ("Unknown capability refusal", None),
    ("Manual native record continuation", None),
    ("Frame revision lineage and digest", None),
    ("Historical commit cutoff", None),
    (
        "Versioned capability replacement",
        Some("Dynamic capability replacement is not implemented"),
    ),
    ("Optimistic revision conflict", None),
    ("Executed read-workflow gate", None),
];
fn aggregate(scenarios: Vec<Value>, duration: u64) -> Value {
    let passed = scenarios.iter().filter(|s| s["status"] == "passed").count();
    let failed = scenarios
        .iter()
        .filter(|s| s["status"] == "failed" || s["status"] == "error")
        .count();
    let not_run = scenarios
        .iter()
        .filter(|s| s["status"] == "not_run")
        .count();
    json!({"kind":"qh-eval","title":"Executed local core checks","suite":"qharness-core-20","evidenceVersion":1,"status":if failed>0 {"failed"} else if not_run>0 {"partial"} else {"passed"},"scope":"bounded_native_behavioral_probes","scenarioCount":scenarios.len(),"executedCount":passed+failed,"passedCount":passed,"failedCount":failed,"notRunCount":not_run,"durationMicros":duration,"scenarios":scenarios,"kpis":{"verifiedTaskSuccessRateBps":null,"missionCompletionRateBps":null,"unsupportedClaimRateBps":null,"authorizationViolationRateBps":null,"externalEffectDuplicationRateBps":null,"recoverySuccessRateBps":null,"permissionLeakageCount":null,"evidenceCompletenessBps":null,"regressionRateBps":null},"kpiSampleCount":0,"releaseStatus":"REVIEW_PENDING"})
}
pub(super) fn run_core_suite() -> Result<Value, String> {
    let all = Instant::now();
    let mut rows = vec![];
    for (i, (name, missing)) in SCENARIOS.iter().enumerate() {
        let id = format!("QH-EVAL-{:03}", i + 1);
        if let Some(reason) = missing {
            rows.push(json!({"id":id,"name":name,"status":"not_run","passed":null,"durationMicros":null,"reason":reason,"observations":[]}));
            continue;
        }
        let start = Instant::now();
        let result = (|| {
            let directory = tempfile::tempdir().map_err(|_| "NATIVE_UNAVAILABLE")?;
            let ws = Workspace::open(directory.path())?;
            probe(i + 1, &ws)
        })();
        let (status, observations, error) = match result {
            Ok(observations) => {
                let good =
                    !observations.is_empty() && observations.iter().all(|v| v["passed"] == true);
                (
                    if good { "passed" } else { "failed" },
                    observations,
                    Value::Null,
                )
            }
            Err(code) => ("error", vec![], json!(code)),
        };
        rows.push(json!({"id":id,"name":name,"status":status,"passed":status=="passed","coverage":"bounded_local_probe","durationMicros":start.elapsed().as_micros() as u64,"observations":observations,"error":error}));
    }
    let mut report = aggregate(rows, all.elapsed().as_micros() as u64);
    report["updatedAtMs"] = json!(now_ms()?);
    Ok(report)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wrong_oracle_is_a_failed_suite_not_a_pass() {
        let report = aggregate(
            vec![
                json!({"status":"passed"}),
                json!({"status":"failed"}),
                json!({"status":"not_run"}),
            ],
            7,
        );
        assert_eq!(report["status"], "failed");
        assert_eq!(report["passedCount"], 1);
        assert_eq!(report["failedCount"], 1);
        assert_eq!(report["notRunCount"], 1);
    }
    #[test]
    fn legacy_canned_records_are_retained_but_never_presented_as_executed_evidence() {
        let root = tempfile::tempdir().unwrap();
        let ws = Workspace::open(root.path()).unwrap();
        let key = Qid::generate().unwrap();
        let id = derive("fixture-eval", &key.0);
        ws.qh_commit(
            &json!({"op":"qhRunEval","key":key.to_canonical_string()}),
            (id, None),
            super::super::qharness::QH_EVALS,
            &json!({"kind":"qh-eval","title":"Legacy fixture","status":"passed","passedCount":20}),
            vec![],
            (Epistemic::Derived, None),
        )
        .unwrap();
        let result = ws.execute(json!({"op":"qhStatus"})).unwrap();
        assert_eq!(
            result["evaluations"][0]["effectiveStatus"],
            "unverified_legacy"
        );
        assert_eq!(result["evaluations"][0]["payload"]["status"], "passed");
    }
}
