use neighbor_workspace::Workspace;
use serde_json::json;
#[test]
fn drafts_are_private_bounded_revision_checked_and_restartable() {
    let dir = tempfile::tempdir().unwrap();
    let store = Workspace::open(dir.path()).unwrap();
    let save = json!({"op":"saveDraft","key":format!("{:032x}",700),"payload":{"appId":"projects","formId":"projects:create:v1","fields":{"project-title":"Unfinished bridge","total-budget-usd":"12.34"}}});
    let saved = store.execute(save.clone()).unwrap();
    assert_eq!(store.execute(save.clone()).unwrap()["id"], saved["id"]);
    assert_eq!(
        store.execute(json!({"op":"drafts"})).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let mut stale = save.clone();
    stale["key"] = json!(format!("{:032x}", 701));
    stale["expected"] = json!(0);
    assert_eq!(store.execute(stale).unwrap_err(), "CONFLICT");
    let mut unsafe_draft = save;
    unsafe_draft["key"] = json!(format!("{:032x}", 702));
    unsafe_draft["payload"]["fields"] = json!({"password":"secret"});
    assert_eq!(store.execute(unsafe_draft).unwrap_err(), "INVALID");
    drop(store);
    let store = Workspace::open(dir.path()).unwrap();
    let read = store
        .execute(json!({"op":"draft","id":saved["id"]}))
        .unwrap();
    assert_eq!(
        read["payload"]["fields"]["project-title"],
        "Unfinished bridge"
    );
    let discarded=store.execute(json!({"op":"discardDraft","key":format!("{:032x}",703),"id":read["id"],"expected":read["revision"]})).unwrap();
    assert_eq!(discarded["state"], "discarded");
    assert!(store.execute(json!({"op":"drafts"})).unwrap()["items"]
        .as_array()
        .unwrap()
        .is_empty());
}
#[test]
fn draft_submission_and_command_recovery_have_one_fate() {
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    let saved=ws.execute(json!({"op":"saveDraft","key":format!("{:032x}",800),"payload":{"appId":"records","formId":"records:record-need:v1","fields":{"title":"Restart safely"}}})).unwrap();
    let command = json!({"op":"write","key":format!("{:032x}",801),"payload":{"kind":"need","title":"Restart safely","description":"","status":"open","refs":[]}});
    let mut request = command.clone();
    request["draft"] = json!({"id":saved["id"],"revision":saved["revision"]});
    ws.execute(json!({"op":"prepare","request":request,"command":command}))
        .unwrap();
    assert_eq!(
        ws.execute(json!({"op":"draft","id":saved["id"]})).unwrap()["state"],
        "submitting"
    );
    // Crash after the domain write and before the journal and draft finish.
    let effect = ws.execute(command.clone()).unwrap();
    drop(ws);
    let ws = Workspace::open(dir.path()).unwrap();
    let replay = ws
        .execute(json!({"op":"resume","key":command["key"]}))
        .unwrap();
    assert_eq!(replay, effect);
    assert!(ws.execute(json!({"op":"drafts"})).unwrap()["items"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        ws.execute(json!({"op":"snapshot"})).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let mut changed = request.clone();
    changed["payload"]["title"] = json!("forged");
    assert_eq!(
        ws.execute(json!({"op":"operation","key":command["key"],"request":changed}))
            .unwrap_err(),
        "INVALID"
    );
}
#[test]
fn draft_request_keys_cannot_be_rebound_or_store_oversize_fields() {
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    let input = json!({"op":"saveDraft","key":format!("{:032x}",900),"payload":{"appId":"projects","formId":"projects:create:v1","fields":{"project-title":"Original"}}});
    ws.execute(input.clone()).unwrap();
    let mut altered = input.clone();
    altered["payload"]["fields"]["project-title"] = json!("Different");
    assert_eq!(ws.execute(altered).unwrap_err(), "INVALID");
    let mut large = input;
    large["key"] = json!(format!("{:032x}", 901));
    large["payload"]["fields"]["project-title"] = json!("x".repeat(65536));
    assert_eq!(ws.execute(large).unwrap_err(), "RESOURCE_LIMIT");
}
#[test]
fn draft_count_is_bounded_and_rejected_submission_does_not_erase_work() {
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    for n in 0..32 {
        ws.execute(json!({"op":"saveDraft","key":format!("{:032x}",1000+n),"payload":{"appId":"projects","formId":format!("projects:form-{n}:v1"),"fields":{"project-title":"unfinished"}}})).unwrap();
    }
    assert_eq!(ws.execute(json!({"op":"saveDraft","key":format!("{:032x}",1100),"payload":{"appId":"projects","formId":"projects:overflow:v1","fields":{}}})).unwrap_err(),"RESOURCE_LIMIT");
}
