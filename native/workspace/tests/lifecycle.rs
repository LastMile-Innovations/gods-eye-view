use neighbor_workspace::Workspace;
use serde_json::{json, Value};
fn key(n: u128) -> String {
    format!("{n:032x}")
}
fn command(n: u128, title: &str) -> Value {
    json!({"op":"write","key":key(n),"payload":{"kind":"task","title":title,"description":"","status":"open","refs":[]}})
}
#[test]
fn prepared_command_survives_restart_and_reuses_exact_receipt_after_effect() {
    let temp = tempfile::tempdir().unwrap();
    let store = Workspace::open(temp.path()).unwrap();
    let cmd = command(10, "Recover this");
    let prepared = store
        .execute(json!({"op":"prepare","request":cmd,"command":cmd}))
        .unwrap();
    assert_eq!(prepared["state"], "pending");
    // Model a crash between the native effect and final journal publication.
    let receipt = store.execute(cmd.clone()).unwrap();
    drop(store);
    let store = Workspace::open(temp.path()).unwrap();
    assert_eq!(
        store.execute(json!({"op":"operations"})).unwrap()["items"][0]["state"],
        "pending"
    );
    let recovered = store.execute(json!({"op":"resume","key":key(10)})).unwrap();
    assert_eq!(recovered, receipt);
    assert_eq!(
        store.execute(json!({"op":"resume","key":key(10)})).unwrap(),
        receipt
    );
    assert_eq!(
        store.execute(json!({"op":"snapshot"})).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(store.execute(json!({"op":"prepare","request":command(10,"Changed"),"command":command(10,"Changed")})).unwrap_err(),"INVALID");
    assert_eq!(
        store.execute(json!({"op":"operations"})).unwrap()["items"][0]["state"],
        "committed"
    );
}
#[test]
fn stale_journaled_command_is_terminal_without_overwriting_record() {
    let temp = tempfile::tempdir().unwrap();
    let store = Workspace::open(temp.path()).unwrap();
    let first = store.execute(command(20, "Initial")).unwrap();
    let mut edit = command(21, "Updated");
    edit["id"] = first["id"].clone();
    edit["expected"] = first["sequence"].clone();
    store.execute(edit.clone()).unwrap();
    edit["key"] = json!(key(22));
    store
        .execute(json!({"op":"prepare","request":edit,"command":edit}))
        .unwrap();
    assert_eq!(
        store
            .execute(json!({"op":"resume","key":key(22)}))
            .unwrap_err(),
        "CONFLICT"
    );
    let ops = store.execute(json!({"op":"operations"})).unwrap();
    assert_eq!(ops["items"][0]["state"], "rejected");
    assert_eq!(ops["items"][0]["error"], "CONFLICT");
    assert_eq!(
        store.execute(json!({"op":"snapshot"})).unwrap()["items"][0]["payload"]["title"],
        "Updated"
    );
}
fn layout() -> Value {
    json!({"version":1,"focused":"records","windows":[{"appId":"records","open":true,"minimized":false,"mode":"normal","rect":{"x":40,"y":120,"width":620,"height":580}}]})
}
#[test]
fn native_desks_are_revisioned_private_layouts_and_delete_preserves_records() {
    let temp = tempfile::tempdir().unwrap();
    let store = Workspace::open(temp.path()).unwrap();
    store.execute(command(30, "Keep record")).unwrap();
    let cmd = json!({"op":"saveDesk","key":key(31),"payload":{"name":"Operations desk","layout":layout()}});
    let saved = store.execute(cmd.clone()).unwrap();
    assert_eq!(saved, store.execute(cmd).unwrap());
    drop(store);
    let store = Workspace::open(temp.path()).unwrap();
    let desks = store.execute(json!({"op":"desks"})).unwrap();
    assert_eq!(desks["items"][0]["payload"]["layout"], layout());
    let bad = json!({"op":"saveDesk","key":key(32),"id":saved["id"],"expected":0,"payload":{"name":"Edited","layout":layout()}});
    assert_eq!(store.execute(bad).unwrap_err(), "CONFLICT");
    let mut leaked = layout();
    leaked["selected"] = json!("private qid");
    assert!(store
        .execute(json!({"op":"saveDesk","key":key(33),"payload":{"name":"Bad","layout":leaked}}))
        .is_err());
    store
        .execute(
            json!({"op":"deleteDesk","key":key(34),"id":saved["id"],"expected":saved["sequence"]}),
        )
        .unwrap();
    assert_eq!(
        store.execute(json!({"op":"desks"})).unwrap()["items"],
        json!([])
    );
    assert_eq!(
        store.execute(json!({"op":"snapshot"})).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn authored_record_history_returns_actual_revisions_not_invented_time() {
    let temp = tempfile::tempdir().unwrap();
    let store = Workspace::open(temp.path()).unwrap();
    let first = store.execute(command(40, "Before")).unwrap();
    let mut edit = command(41, "After");
    edit["id"] = first["id"].clone();
    edit["expected"] = first["sequence"].clone();
    let second = store.execute(edit).unwrap();
    let history = store
        .execute(json!({"op":"history","id":first["id"]}))
        .unwrap();
    assert_eq!(history["items"][0]["payload"]["title"], "After");
    assert_eq!(history["items"][1]["payload"]["title"], "Before");
    assert_eq!(history["items"][0]["revision"], second["sequence"]);
    assert_eq!(history["validTimeSupported"], false);
}
