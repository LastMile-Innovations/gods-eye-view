use neighbor_workspace::Workspace;
use serde_json::{json, Value};
fn write(key: &str, kind: &str, title: &str) -> Value {
    json!({"op":"write","key":key,"payload":{"kind":kind,"title":title,"description":"","status":"open","refs":[]}})
}
const A: &str = "11111111111111111111111111111111";
const B: &str = "22222222222222222222222222222222";
#[test]
fn records_survive_restart_and_exact_retries_conflict_on_changed_input() {
    let temp = tempfile::tempdir().unwrap();
    let store = Workspace::open(temp.path()).unwrap();
    let cmd = write(A, "need", "Repair north fence");
    let first = store.execute(cmd.clone()).unwrap();
    assert_eq!(first["status"], "committed");
    assert_eq!(store.execute(cmd).unwrap(), first);
    assert!(store.execute(write(A, "need", "Altered request")).is_err());
    drop(store);
    let reopened = Workspace::open(temp.path()).unwrap();
    let snap = reopened.execute(json!({"op":"snapshot"})).unwrap();
    assert_eq!(snap["items"].as_array().unwrap().len(), 1);
    assert_eq!(snap["items"][0]["id"], first["id"]);
    assert_eq!(snap["items"][0]["payload"]["title"], "Repair north fence");
}
#[test]
fn stale_update_and_invalid_refs_have_no_effect() {
    let temp = tempfile::tempdir().unwrap();
    let store = Workspace::open(temp.path()).unwrap();
    let first = store.execute(write(A, "task", "Inspect gate")).unwrap();
    let mut edit = write(B, "task", "Inspect gate");
    edit["id"] = first["id"].clone();
    edit["expected"] = first["sequence"].clone();
    edit["payload"]["status"] = json!("done");
    store.execute(edit.clone()).unwrap();
    edit["key"] = json!("33333333333333333333333333333333");
    assert_eq!(store.execute(edit).unwrap_err(), "CONFLICT");
    let mut bad = write("44444444444444444444444444444444", "task", "Dangling link");
    bad["payload"]["refs"] = json!(["99999999999999999999999999999999"]);
    assert_eq!(store.execute(bad).unwrap_err(), "NOT_AVAILABLE");
    let snap = store.execute(json!({"op":"snapshot"})).unwrap();
    assert_eq!(snap["items"].as_array().unwrap().len(), 1);
    assert_eq!(snap["items"][0]["payload"]["status"], "done");
}
#[test]
fn imported_document_preserves_original_and_links_to_native_task() {
    let temp = tempfile::tempdir().unwrap();
    let store = Workspace::open(temp.path()).unwrap();
    let text = "# North fence\nThree posts need inspection.\n";
    let cmd = json!({"op":"import","key":A,"payload":{"kind":"document","title":"walkthrough.md","description":"Private import","status":"open","refs":[]},"original":text});
    let doc = store.execute(cmd.clone()).unwrap();
    assert_eq!(store.execute(cmd).unwrap(), doc);
    let mut task = write(B, "task", "Inspect three posts");
    task["payload"]["refs"] = json!([doc["id"]]);
    store.execute(task).unwrap();
    assert_eq!(
        store
            .execute(json!({"op":"evidence","id":doc["id"]}))
            .unwrap()["original"],
        text
    );
    drop(store);
    let again = Workspace::open(temp.path()).unwrap();
    assert_eq!(
        again.execute(json!({"op":"snapshot"})).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}
#[test]
fn unsupported_commands_and_untrusted_fields_are_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let store = Workspace::open(temp.path()).unwrap();
    assert!(store.execute(json!({"op":"delete-everything"})).is_err());
    let mut bad = write(A, "task", "  ");
    assert!(store.execute(bad.clone()).is_err());
    bad["payload"]["title"] = json!("valid");
    bad["payload"]["actor"] = json!("owner");
    assert!(store.execute(bad).is_err());
    assert_eq!(
        store.execute(json!({"op":"snapshot"})).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
}
