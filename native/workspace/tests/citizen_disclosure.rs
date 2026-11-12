use neighbor_workspace::Workspace;
use serde_json::{json, Value};
fn key(n: u128) -> String {
    format!("{n:032x}")
}
fn original(s: &Workspace, n: u128, bytes: Vec<u8>) -> Value {
    s.execute(json!({"op":"preserveEvidence","key":key(n),"permissionConfirmed":true,"bytes":bytes,"payload":{"title":"PRIVATE_SOURCE_TITLE","fileName":"PRIVATE_NAME.txt","mediaType":"text/plain","family":"04","sourceType":"firsthand","originGroup":"PRIVATE_GROUP","dependsOn":null,"notes":"PRIVATE_NOTES","assertedCapturedAt":"PRIVATE_TIME","coordinates":[123.1,45.2]}})).unwrap()
}
fn derived(s: &Workspace, n: u128, parent: &Value) -> Value {
    s.execute(json!({"op":"deriveEvidenceText","key":key(n),"parent":parent["id"],"expected":parent["sequence"],"title":"Reviewed excerpt","ranges":[[3,9]],"note":"PRIVATE_REDACTION_REASON"})).unwrap()
}
fn reviewed(s: &Workspace, n: u128, a: &Value) -> Value {
    s.execute(json!({"op":"reviewEvidence","key":key(n),"id":a["id"],"expected":a["sequence"],"state":"under_review","note":"Private reviewer context"})).unwrap()
}
fn book(s: &Workspace, n: u128, a: &Value) -> Value {
    s.execute(json!({"op":"saveCasebook","key":key(n),"payload":{"title":"PRIVATE_BOOK","description":"PRIVATE_DESCRIPTION","artifacts":[a["id"]],"claims":[]}})).unwrap()
}
fn approval(n: u128, b: &Value, a: &Value) -> Value {
    json!({"op":"saveEvidenceDisclosure","key":key(n),"payload":{"title":"Selected public excerpt","scope":"local-download","approvalConfirmed":true,"casebook":{"id":b["id"],"revision":b["sequence"]},"artifacts":[{"id":a["id"],"revision":a["sequence"]}],"claims":[]}})
}
#[test]
fn native_unicode_redaction_preserves_original_lineage_and_recovery() {
    let tmp = tempfile::tempdir().unwrap();
    let s = Workspace::open(tmp.path()).unwrap();
    let raw = "é SECRET public\r\n".as_bytes().to_vec();
    let p = original(&s, 200, raw.clone());
    let cmd = json!({"op":"deriveEvidenceText","key":key(201),"parent":p["id"],"expected":p["sequence"],"title":"Reviewed excerpt","ranges":[[3,9]],"note":"Private reason"});
    s.execute(json!({"op":"prepare","request":cmd,"command":cmd}))
        .unwrap();
    let a = s.execute(cmd.clone()).unwrap();
    drop(s);
    let s = Workspace::open(tmp.path()).unwrap();
    assert_eq!(s.execute(json!({"op":"resume","key":key(201)})).unwrap(), a);
    assert_eq!(
        s.execute(json!({"op":"artifactOriginal","id":p["id"]}))
            .unwrap()["bytes"],
        json!(raw)
    );
    let child = s
        .execute(json!({"op":"artifactOriginal","id":a["id"]}))
        .unwrap();
    assert_eq!(child["bytes"], json!("é [REDACTED] public\r\n".as_bytes()));
    let net = s.execute(json!({"op":"evidenceNetwork"})).unwrap();
    let row = net["artifacts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == a["id"])
        .unwrap();
    assert_eq!(
        row["payload"]["transformation"]["profile"],
        "utf8-byte-redaction-v1"
    );
    assert_eq!(row["payload"]["dependsOn"], p["id"]);
    assert_eq!(row["payload"]["sourceType"], "received_copy");
    let mut changed = cmd;
    changed["title"] = json!("Changed");
    assert_eq!(s.execute(changed).unwrap_err(), "INVALID");
}
#[test]
fn redaction_rejects_invalid_unicode_ranges_and_stale_parent() {
    let tmp = tempfile::tempdir().unwrap();
    let s = Workspace::open(tmp.path()).unwrap();
    let p = original(&s, 210, "é SECRET public".as_bytes().to_vec());
    for (i, ranges) in [
        json!([]),
        json!([[1, 2]]),
        json!([[3, 9], [8, 10]]),
        json!([[3, 999]]),
        json!([[9, 3]]),
        json!([[3, 3]]),
    ]
    .into_iter()
    .enumerate()
    {
        assert_eq!(s.execute(json!({"op":"deriveEvidenceText","key":key(211+i as u128),"parent":p["id"],"expected":p["sequence"],"title":"Excerpt","ranges":ranges,"note":"Reason"})).unwrap_err(),"INVALID");
    }
    reviewed(&s, 220, &p);
    assert_eq!(s.execute(json!({"op":"deriveEvidenceText","key":key(221),"parent":p["id"],"expected":p["sequence"],"title":"Excerpt","ranges":[[3,9]],"note":"Reason"})).unwrap_err(),"CONFLICT");
    let binary = original(&s, 222, vec![0xff, 0]);
    assert_eq!(s.execute(json!({"op":"deriveEvidenceText","key":key(223),"parent":binary["id"],"expected":binary["sequence"],"title":"Excerpt","ranges":[[0,1]],"note":"Reason"})).unwrap_err(),"INVALID");
}
#[test]
fn correction_history_paginates_real_claim_revisions_and_preserves_contradictions() {
    let tmp = tempfile::tempdir().unwrap();
    let s = Workspace::open(tmp.path()).unwrap();
    let a = original(&s, 230, b"earlier source".to_vec());
    let b = original(&s, 231, b"counter record".to_vec());
    let c = json!({"op":"saveEvidenceClaim","key":key(232),"payload":{"text":"Initial attribution","status":"unverified","supporting":[a["id"]],"contradicting":[],"rationale":"Initial limited source","independenceAttested":false}});
    let before = s.execute(c.clone()).unwrap();
    let mut corrected = c;
    corrected["key"] = json!(key(233));
    corrected["id"] = before["id"].clone();
    corrected["expected"] = before["sequence"].clone();
    corrected["payload"]["text"] = json!("Attribution refuted by counter record");
    corrected["payload"]["status"] = json!("refuted");
    corrected["payload"]["contradicting"] = json!([b["id"]]);
    corrected["payload"]["rationale"] = json!("Correction explains the counter evidence.");
    let after = s.execute(corrected.clone()).unwrap();
    corrected["key"] = json!(key(234));
    assert_eq!(s.execute(corrected).unwrap_err(), "CONFLICT");
    let h = s
        .execute(json!({"op":"citizenHistory","id":before["id"],"limit":1}))
        .unwrap();
    assert_eq!(h["items"][0]["revision"], after["sequence"]);
    assert_eq!(h["items"][0]["payload"]["status"], "refuted");
    assert_eq!(h["truncated"], true);
    let older = s
        .execute(json!({"op":"citizenHistory","id":before["id"],"before":h["nextBefore"]}))
        .unwrap();
    assert_eq!(older["items"][0]["payload"]["text"], "Initial attribution");
}
#[test]
fn scoped_dossier_excludes_private_material_and_revalidates_all_heads() {
    let tmp = tempfile::tempdir().unwrap();
    let s = Workspace::open(tmp.path()).unwrap();
    let p = original(&s, 240, "é SECRET public\r\n".as_bytes().to_vec());
    let d = derived(&s, 241, &p);
    let a = reviewed(&s, 242, &d);
    let b = book(&s, 243, &a);
    let cmd = approval(244, &b, &a);
    let approved = s.execute(cmd.clone()).unwrap();
    assert_eq!(s.execute(cmd).unwrap(), approved);
    let exported = s
        .execute(json!({"op":"evidenceDossier","id":approved["id"]}))
        .unwrap();
    assert_eq!(exported["format"], "neighbor-evidence-dossier-v1");
    assert_eq!(exported["artifacts"][0]["text"], "é [REDACTED] public\r\n");
    let wire = exported.to_string();
    for private in [
        "SECRET",
        "PRIVATE_",
        "coordinates",
        "originGroup",
        "nativeContent",
        "dependsOn",
        p["id"].as_str().unwrap(),
        a["id"].as_str().unwrap(),
    ] {
        assert!(!wire.contains(private), "leaked {private}");
    }
    drop(s);
    let s = Workspace::open(tmp.path()).unwrap();
    assert_eq!(
        s.execute(json!({"op":"evidenceDossier","id":approved["id"]}))
            .unwrap(),
        exported
    );
    reviewed(&s, 245, &p);
    assert_eq!(
        s.execute(json!({"op":"evidenceDossier","id":approved["id"]}))
            .unwrap_err(),
        "CONFLICT"
    );
    let fresh = s.execute(approval(246, &b, &a)).unwrap();
    s.execute(json!({"op":"withdrawEvidenceDisclosure","key":key(247),"id":fresh["id"],"expected":fresh["sequence"],"note":"Approval withdrawn"})).unwrap();
    assert_eq!(
        s.execute(json!({"op":"evidenceDossier","id":fresh["id"]}))
            .unwrap_err(),
        "NOT_AVAILABLE"
    );
}
#[test]
fn disclosure_requires_reviewed_derivatives_complete_citations_and_explicit_approval() {
    let tmp = tempfile::tempdir().unwrap();
    let s = Workspace::open(tmp.path()).unwrap();
    let p = original(&s, 250, "é SECRET public".as_bytes().to_vec());
    let b = book(&s, 251, &p);
    assert_eq!(s.execute(approval(252, &b, &p)).unwrap_err(), "INVALID");
    let d = derived(&s, 253, &p);
    let b = book(&s, 254, &d);
    assert_eq!(s.execute(approval(255, &b, &d)).unwrap_err(), "INVALID");
    let a = reviewed(&s, 256, &d);
    let mut bad = approval(257, &b, &a);
    bad["payload"]["approvalConfirmed"] = json!(false);
    assert_eq!(s.execute(bad).unwrap_err(), "INVALID");
    let unrelated = original(&s, 263, b"Unrepresented source".to_vec());
    let c=s.execute(json!({"op":"saveEvidenceClaim","key":key(258),"payload":{"text":"Claim cites unrepresented source","status":"unverified","supporting":[unrelated["id"]],"contradicting":[],"rationale":"Source retained privately","independenceAttested":false}})).unwrap();
    let updated=s.execute(json!({"op":"saveCasebook","key":key(259),"id":b["id"],"expected":b["sequence"],"payload":{"title":"Private case","description":"","artifacts":[a["id"]],"claims":[c["id"]]}})).unwrap();
    let mut incomplete = approval(260, &updated, &a);
    incomplete["payload"]["claims"] = json!([{"id":c["id"],"revision":c["sequence"]}]);
    assert_eq!(s.execute(incomplete).unwrap_err(), "INVALID");
    s.execute(json!({"op":"reviewEvidence","key":key(261),"id":p["id"],"expected":p["sequence"],"state":"restricted","note":"Source restricted"})).unwrap();
    assert_eq!(
        s.execute(approval(262, &updated, &a)).unwrap_err(),
        "INVALID"
    );
}

#[test]
fn dossier_maps_original_citations_to_unique_descendants_without_rewriting_claim() {
    let tmp = tempfile::tempdir().unwrap();
    let s = Workspace::open(tmp.path()).unwrap();
    let first = original(&s, 300, "é SECRET witness one".as_bytes().to_vec());
    // A second synthetic firsthand acquisition declares a different source group.
    let other=s.execute(json!({"op":"preserveEvidence","key":key(302),"permissionConfirmed":true,"bytes":"é SECRET second source".as_bytes(),"payload":{"title":"Other original","fileName":"other.txt","mediaType":"text/plain","family":"04","sourceType":"firsthand","originGroup":"separate-observer","dependsOn":null,"notes":"Synthetic independent acquisition","assertedCapturedAt":null,"coordinates":null}})).unwrap();
    let da = derived(&s, 303, &first);
    let a = reviewed(&s, 304, &da);
    let db = derived(&s, 305, &other);
    let b = reviewed(&s, 306, &db);
    let claim=s.execute(json!({"op":"saveEvidenceClaim","key":key(307),"payload":{"text":"Two original records support the assessment","status":"corroborated","supporting":[first["id"],other["id"]],"contradicting":[],"rationale":"Synthetic reviewer attestation over declared independent sources.","independenceAttested":true}})).unwrap();
    let book=s.execute(json!({"op":"saveCasebook","key":key(308),"payload":{"title":"PRIVATE_BOOK","description":"","artifacts":[a["id"],b["id"]],"claims":[claim["id"]]}})).unwrap();
    let mut cmd = approval(309, &book, &a);
    cmd["payload"]["artifacts"] =
        json!([{"id":a["id"],"revision":a["sequence"]},{"id":b["id"],"revision":b["sequence"]}]);
    cmd["payload"]["claims"] = json!([{"id":claim["id"],"revision":claim["sequence"]}]);
    let saved = s.execute(cmd.clone()).unwrap();
    let dossier = s
        .execute(json!({"op":"evidenceDossier","id":saved["id"]}))
        .unwrap();
    assert_eq!(dossier["claims"][0]["supporting"], json!([0, 1]));
    assert_eq!(dossier["claims"][0]["status"], "corroborated");
    let net = s.execute(json!({"op":"evidenceNetwork"})).unwrap();
    assert_eq!(
        net["claims"][0]["payload"]["supporting"],
        json!([first["id"], other["id"]])
    );
    assert!(!dossier.to_string().contains(first["id"].as_str().unwrap()));
    // Two selected descendants of the same cited original have no implicit preferred excerpt.
    let extra = derived(&s, 310, &first);
    let extra = reviewed(&s, 311, &extra);
    let updated=s.execute(json!({"op":"saveCasebook","key":key(312),"id":book["id"],"expected":book["sequence"],"payload":{"title":"PRIVATE_BOOK","description":"","artifacts":[a["id"],b["id"],extra["id"]],"claims":[claim["id"]]}})).unwrap();
    cmd["key"] = json!(key(313));
    cmd["payload"]["casebook"] = json!({"id":updated["id"],"revision":updated["sequence"]});
    cmd["payload"]["artifacts"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":extra["id"],"revision":extra["sequence"]}));
    assert_eq!(s.execute(cmd).unwrap_err(), "INVALID");
}
