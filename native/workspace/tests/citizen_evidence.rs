use neighbor_workspace::Workspace;
use serde_json::{json, Value};
fn key(n: u128) -> String {
    format!("{n:032x}")
}
fn artifact(n: u128, group: &str, bytes: Vec<u8>) -> Value {
    json!({"op":"preserveEvidence","key":key(n),"permissionConfirmed":true,"bytes":bytes,"payload":{"title":"Private evidence","fileName":"source.bin","mediaType":"application/octet-stream","family":"04","sourceType":"firsthand","originGroup":group,"dependsOn":null,"notes":"Contributor context, not a verified fact.","assertedCapturedAt":null,"coordinates":null}})
}
#[test]
fn citizen_binary_original_digest_custody_and_restart() {
    let tmp = tempfile::tempdir().unwrap();
    let s = Workspace::open(tmp.path()).unwrap();
    let cmd = artifact(100, "one", vec![0, 255, 13, 10, 0, 42]);
    let saved = s.execute(cmd.clone()).unwrap();
    assert_eq!(s.execute(cmd).unwrap(), saved);
    let before = s
        .execute(json!({"op":"artifactOriginal","id":saved["id"]}))
        .unwrap();
    assert_eq!(before["bytes"], json!([0, 255, 13, 10, 0, 42]));
    assert_eq!(before["blake3"].as_str().unwrap().len(), 64);
    let net = s.execute(json!({"op":"evidenceNetwork"})).unwrap();
    assert_eq!(net["artifacts"][0]["payload"]["lifecycle"], "preserved");
    assert_eq!(
        net["artifacts"][0]["payload"]["integrity"]["sha256"],
        before["sha256"]
    );
    let review = json!({"op":"reviewEvidence","key":key(101),"id":saved["id"],"expected":saved["sequence"],"state":"under_review","note":"Human review started; truth is not verified."});
    s.execute(review).unwrap();
    drop(s);
    let s = Workspace::open(tmp.path()).unwrap();
    assert_eq!(
        s.execute(json!({"op":"artifactOriginal","id":saved["id"]}))
            .unwrap(),
        before
    );
    let custody = s
        .execute(json!({"op":"evidenceCustody","id":saved["id"]}))
        .unwrap();
    assert_eq!(custody["items"].as_array().unwrap().len(), 2);
    assert!(s.execute(json!({"op":"reviewEvidence","key":key(102),"id":saved["id"],"expected":saved["sequence"],"state":"published","note":"Bypass"})).is_err());
}
#[test]
fn duplicate_and_reposted_bytes_cannot_manufacture_independent_corroboration() {
    let tmp = tempfile::tempdir().unwrap();
    let s = Workspace::open(tmp.path()).unwrap();
    let a = s
        .execute(artifact(110, "observer-a", vec![1, 2, 3]))
        .unwrap();
    let b = s
        .execute(artifact(111, "observer-b", vec![1, 2, 3]))
        .unwrap();
    let claim = json!({"op":"saveEvidenceClaim","key":key(112),"payload":{"text":"The reported condition needs investigation.","status":"corroborated","supporting":[a["id"],b["id"]],"contradicting":[],"rationale":"Reviewer declares independent acquisition based on context.","independenceAttested":true}});
    assert_eq!(s.execute(claim.clone()).unwrap_err(), "INVALID");
    let mut repost = artifact(113, "another-origin", vec![9, 8, 7]);
    repost["payload"]["sourceType"] = json!("received_copy");
    repost["payload"]["dependsOn"] = a["id"].clone();
    let r = s.execute(repost).unwrap();
    let mut bad = claim.clone();
    bad["key"] = json!(key(114));
    bad["payload"]["supporting"] = json!([a["id"], r["id"]]);
    assert_eq!(s.execute(bad).unwrap_err(), "INVALID");
    let c = s
        .execute(artifact(115, "observer-c", vec![4, 5, 6]))
        .unwrap();
    let mut good = claim;
    good["key"] = json!(key(116));
    good["payload"]["supporting"] = json!([a["id"], c["id"]]);
    let result = s.execute(good).unwrap();
    let net = s.execute(json!({"op":"evidenceNetwork"})).unwrap();
    assert_eq!(net["claims"][0]["payload"]["declaredIndependentGroups"], 2);
    assert_eq!(net["claims"][0]["payload"]["automaticallyVerified"], false);
    let book=s.execute(json!({"op":"saveCasebook","key":key(117),"payload":{"title":"Local casebook","description":"Review only","artifacts":[a["id"],c["id"]],"claims":[result["id"]]}})).unwrap();
    assert!(book["id"].is_string());
}
#[test]
fn citizen_intake_requires_permission_and_journal_preserves_binary_without_listing_it() {
    let tmp = tempfile::tempdir().unwrap();
    let s = Workspace::open(tmp.path()).unwrap();
    let mut bad = artifact(120, "unknown", vec![1]);
    bad["permissionConfirmed"] = json!(false);
    assert!(s.execute(bad).is_err());
    let cmd = artifact(121, "one", vec![0, 255, 10]);
    s.execute(json!({"op":"prepare","request":cmd,"command":cmd}))
        .unwrap();
    let pending = s.execute(json!({"op":"operations"})).unwrap();
    assert_eq!(pending["items"][0]["state"], "pending");
    assert!(!pending.to_string().contains("bytes"));
    drop(s);
    let s = Workspace::open(tmp.path()).unwrap();
    let saved = s.execute(json!({"op":"resume","key":key(121)})).unwrap();
    assert_eq!(
        s.execute(json!({"op":"artifactOriginal","id":saved["id"]}))
            .unwrap()["bytes"],
        json!([0, 255, 10])
    );
}
#[test]
fn six_dimensions_record_review_without_minting_factual_verification() {
    let tmp = tempfile::tempdir().unwrap();
    let s = Workspace::open(tmp.path()).unwrap();
    let saved = s.execute(artifact(140, "one", vec![])).unwrap();
    let mut dimensions = json!({});
    for name in [
        "integrity",
        "origin",
        "time",
        "location",
        "content",
        "corroboration",
    ] {
        dimensions[name] = json!({"assessment":"not_assessed","notes":""});
    }
    dimensions["integrity"] = json!({"assessment":"supported","notes":"Stored byte digest matches retained original; truth not assessed."});
    s.execute(json!({"op":"reviewEvidence","key":key(141),"id":saved["id"],"expected":saved["sequence"],"state":"under_review","note":"Six dimensions assessed separately.","dimensions":dimensions})).unwrap();
    let data = s.execute(json!({"op":"evidenceNetwork"})).unwrap();
    assert_eq!(
        data["artifacts"][0]["payload"]["verificationDimensions"],
        dimensions
    );
    assert_eq!(
        data["artifacts"][0]["payload"]["integrity"]["factualVerification"],
        false
    );
    let bytes = s
        .execute(json!({"op":"artifactOriginal","id":saved["id"]}))
        .unwrap();
    assert_eq!(
        bytes["sha256"],
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_eq!(
        bytes["blake3"],
        "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"
    );
}
