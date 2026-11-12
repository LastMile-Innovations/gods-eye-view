use neighbor_workspace::Workspace;
use serde_json::{json, Value};

fn key(n: u64) -> String {
    format!("{n:032x}")
}
fn workflow(n: u64) -> Value {
    json!({"op":"qhSaveWorkflow","key":key(n),"payload":{"workflowId":"private.overview.v1","title":"Private overview","origin":"authored","stages":[{"id":"records","action":"quanta.query"},{"id":"offers","action":"market.searchOffers"}]}})
}
fn row(store: &Workspace, collection: &str, id: &Value) -> Value {
    store.execute(json!({"op":"qhStatus"})).unwrap()[collection]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == *id)
        .unwrap()
        .clone()
}
fn mandate(n: u64) -> Value {
    json!({"op":"qhCreateMandate","key":key(n),"payload":{"title":"Read context mandate","purpose":"Read authorized context","permittedCapabilities":["quanta.query"],"permittedEffects":["read"],"budget":{"maxModelCalls":2,"maxToolCalls":4,"maxTokens":100,"maxWallTimeMs":1000,"maxCost":{"amountMinorUnits":50,"currency":"USD"},"maxDelegationDepth":2}}})
}
#[test]
fn delegated_token_time_currency_and_ancestor_revocation_cannot_expand_authority() {
    let root = tempfile::tempdir().unwrap();
    let store = Workspace::open(root.path()).unwrap();
    let parent = store.execute(mandate(400)).unwrap();
    for (n, field, value) in [
        (401, "maxTokens", json!(101)),
        (402, "maxWallTimeMs", json!(1001)),
        (
            403,
            "maxCost",
            json!({"amountMinorUnits":50,"currency":"EUR"}),
        ),
    ] {
        let mut child = mandate(n);
        child["payload"]["parentMandateId"] = parent["id"].clone();
        child["payload"]["budget"]["maxDelegationDepth"] = json!(1);
        child["payload"]["budget"][field] = value;
        assert_eq!(store.execute(child).unwrap_err(), "PERMISSION_DENIED");
    }
    let mut child = mandate(404);
    child["payload"]["parentMandateId"] = parent["id"].clone();
    child["payload"]["budget"]["maxDelegationDepth"] = json!(1);
    let saved = store.execute(child).unwrap();
    store.execute(json!({"op":"qhRevokeMandate","key":key(405),"mandateId":parent["id"],"expected":parent["sequence"],"reason":"Owner revoked parent authority"})).unwrap();
    assert_eq!(store.execute(json!({"op":"qhCompileFrame","key":key(406),"payload":{"objective":"Must refuse revoked ancestry","mandateId":saved["id"]}})).unwrap_err(),"PERMISSION_DENIED");
}
#[test]
fn evaluation_executes_checks_without_creating_fixture_records_in_the_account() {
    let root = tempfile::tempdir().unwrap();
    let store = Workspace::open(root.path()).unwrap();
    let request = json!({"op":"qhRunEval","key":key(100),"suite":"qharness-core-20"});
    let receipt = store.execute(request.clone()).unwrap();
    let result = row(&store, "evaluations", &receipt["id"]);
    assert_eq!(result["effectiveStatus"], "partial");
    let report = &result["payload"];
    assert_eq!(report["evidenceVersion"], 1);
    assert_eq!(report["scenarioCount"], 20);
    assert!(report["executedCount"].as_u64().unwrap() > 0);
    assert!(report["notRunCount"].as_u64().unwrap() > 0);
    assert_eq!(report["failedCount"], 0);
    assert!(report["kpis"]["verifiedTaskSuccessRateBps"].is_null());
    for check in report["scenarios"].as_array().unwrap() {
        if check["status"] == "passed" {
            assert!(check["durationMicros"].is_number());
            assert!(!check["observations"].as_array().unwrap().is_empty());
        } else {
            assert_eq!(check["status"], "not_run");
            assert!(check["passed"].is_null());
        }
    }
    assert_eq!(store.execute(request.clone()).unwrap(), receipt);
    let mut forged = request;
    forged["passedCount"] = json!(20);
    assert_eq!(store.execute(forged).unwrap_err(), "INVALID");
    assert_eq!(
        store
            .execute(json!({"op":"qhRunEval","key":key(101),"suite":"arbitrary"}))
            .unwrap_err(),
        "INVALID"
    );
    assert!(store.execute(json!({"op":"snapshot"})).unwrap()["items"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(store.execute(json!({"op":"qhStatus"})).unwrap()["mandates"]
        .as_array()
        .unwrap()
        .is_empty());
    drop(store);
    let store = Workspace::open(root.path()).unwrap();
    assert_eq!(row(&store, "evaluations", &receipt["id"]), result);
}
#[test]
fn workflows_require_executed_definition_pinned_validation_and_read_current_native_state() {
    let root = tempfile::tempdir().unwrap();
    let store = Workspace::open(root.path()).unwrap();
    let create = workflow(200);
    let saved = store.execute(create.clone()).unwrap();
    assert_eq!(
        row(&store, "workflows", &saved["id"])["payload"]["status"],
        "draft_validation_required"
    );
    let run = json!({"op":"qhExecute","operation":"execute","execution":{"strategy":"workflow","interaction":"sync"},"workflowId":saved["id"]});
    assert_eq!(store.execute(run.clone()).unwrap_err(), "PERMISSION_DENIED");
    let mut forged = workflow(201);
    forged["payload"]["validatedByEval"] = json!(true);
    assert_eq!(store.execute(forged).unwrap_err(), "PERMISSION_DENIED");
    let validation = json!({"op":"qhValidateWorkflow","key":key(202),"workflowId":saved["id"],"expected":saved["sequence"]});
    let validated = store.execute(validation.clone()).unwrap();
    assert_eq!(store.execute(validation).unwrap(), validated);
    store.execute(json!({"op":"write","key":key(203),"payload":{"kind":"need","title":"Real native need","description":"Synthetic acceptance","status":"open","refs":[]}})).unwrap();
    let output = store.execute(run.clone()).unwrap();
    assert_eq!(output["executionMode"], "native_read_only");
    assert_eq!(
        output["stages"][0]["output"]["items"][0]["payload"]["title"],
        "Real native need"
    );
    assert_eq!(output["usage"]["modelCalls"], 0);
    let current = row(&store, "workflows", &saved["id"]);
    let mut edited = create;
    edited["key"] = json!(key(204));
    edited["id"] = saved["id"].clone();
    edited["expected"] = current["revision"].clone();
    edited["payload"]["title"] = json!("Edited overview");
    store.execute(edited).unwrap();
    assert_eq!(store.execute(run).unwrap_err(), "PERMISSION_DENIED");
}
#[test]
fn stage_payloads_cannot_smuggle_commands_or_approval() {
    let root = tempfile::tempdir().unwrap();
    let store = Workspace::open(root.path()).unwrap();
    for (n, stage) in [
        (300, json!({"id":"bad","action":"saveProject"})),
        (
            301,
            json!({"id":"bad","action":"quanta.query","input":{"principal":"other"}}),
        ),
        (
            302,
            json!({"id":"bad","action":"quanta.query","command":{"op":"write"}}),
        ),
    ] {
        let mut cmd = workflow(n);
        cmd["payload"]["stages"] = json!([stage]);
        assert!(store.execute(cmd).is_err());
    }
}

#[test]
fn workflow_identity_and_output_budget_are_enforced_without_promoting_failed_validation() {
    let root = tempfile::tempdir().unwrap();
    let store = Workspace::open(root.path()).unwrap();
    let record=store.execute(json!({"op":"write","key":key(500),"payload":{"kind":"need","title":"Original native kind","description":"","status":"open","refs":[]}})).unwrap();
    let mut forged = workflow(501);
    forged["id"] = record["id"].clone();
    forged["expected"] = record["sequence"].clone();
    assert_eq!(store.execute(forged).unwrap_err(), "NOT_AVAILABLE");
    let saved = store.execute(workflow(502)).unwrap();
    store.execute(json!({"op":"qhValidateWorkflow","key":key(503),"workflowId":saved["id"],"expected":saved["sequence"]})).unwrap();
    let limited = json!({"op":"qhExecute","operation":"execute","execution":{"strategy":"workflow","interaction":"sync"},"workflowId":saved["id"],"budget":{"maxToolCalls":1}});
    assert_eq!(store.execute(limited).unwrap_err(), "RESOURCE_LIMIT");
    let mut large = workflow(504);
    large["payload"]["stages"] = json!((0..8)
        .map(|i| json!({"id":format!("read-{i}"),"action":"quanta.query"}))
        .collect::<Vec<_>>());
    let large_saved = store.execute(large).unwrap();
    for n in 600..620 {
        store.execute(json!({"op":"write","key":key(n),"payload":{"kind":"need","title":format!("Synthetic bounded output {n}"),"description":"a".repeat(9000),"status":"open","refs":[]}})).unwrap();
    }
    assert_eq!(store.execute(json!({"op":"qhValidateWorkflow","key":key(505),"workflowId":large_saved["id"],"expected":large_saved["sequence"]})).unwrap_err(),"RESOURCE_LIMIT");
    assert_eq!(
        row(&store, "workflows", &large_saved["id"])["payload"]["status"],
        "draft_validation_required"
    );
}

#[test]
fn validation_receipt_recovers_after_domain_commit_before_journal_finish() {
    let root = tempfile::tempdir().unwrap();
    let store = Workspace::open(root.path()).unwrap();
    let saved = store.execute(workflow(700)).unwrap();
    let command = json!({"op":"qhValidateWorkflow","key":key(701),"workflowId":saved["id"],"expected":saved["sequence"]});
    store
        .execute(json!({"op":"prepare","request":command,"command":command}))
        .unwrap();
    let receipt = store.execute(command.clone()).unwrap();
    drop(store);
    let store = Workspace::open(root.path()).unwrap();
    assert_eq!(
        store
            .execute(json!({"op":"resume","key":command["key"]}))
            .unwrap(),
        receipt
    );
    let status = store.execute(json!({"op":"qhStatus"})).unwrap();
    assert_eq!(status["summary"]["evaluationCount"], 1);
    assert_eq!(
        status["workflows"][0]["payload"]["status"],
        "validated_read_only"
    );
}

#[test]
fn mandate_defaults_inherit_expiry_and_never_silently_expand_the_parent_budget() {
    let root = tempfile::tempdir().unwrap();
    let store = Workspace::open(root.path()).unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let mut parent = mandate(800);
    parent["payload"]["expiresAtMs"] = json!(now + 60000);
    let saved = store.execute(parent).unwrap();
    let mut child = mandate(801);
    child["payload"]["parentMandateId"] = saved["id"].clone();
    child["payload"]["budget"] = json!({"maxCost":{"amountMinorUnits":10,"currency":"USD"}});
    let delegated = store.execute(child.clone()).unwrap();
    let read = row(&store, "mandates", &delegated["id"]);
    assert_eq!(read["payload"]["budget"]["maxTokens"], 100);
    assert_eq!(read["payload"]["budget"]["maxDelegationDepth"], 1);
    assert_eq!(read["payload"]["expiresAtMs"], now + 60000);
    child["key"] = json!(key(802));
    child["payload"]["expiresAtMs"] = json!(now + 120000);
    assert_eq!(store.execute(child).unwrap_err(), "PERMISSION_DENIED");
    let mut expired = mandate(803);
    expired["payload"]["expiresAtMs"] = json!(1);
    assert_eq!(store.execute(expired).unwrap_err(), "INVALID");
    let mut duplicate = workflow(804);
    duplicate["payload"]["stages"] =
        json!([{"id":"same","action":"quanta.query"},{"id":"same","action":"market.searchOffers"}]);
    assert_eq!(store.execute(duplicate).unwrap_err(), "INVALID");
}
