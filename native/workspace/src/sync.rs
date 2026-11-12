//! Coherent disposable projections over one serialized native workspace session.
use super::*;

impl Workspace {
    pub(super) fn sync(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "cursor"])?;
        // Authentication belongs to the embedding transport. Recheck native
        // authority before considering even an unchanged or malformed cursor.
        let db = self.db()?;
        let pin = db.snapshot().map_err(err)?;
        let sequence = db
            .snapshot_sequence(&pin, self.domain, self.owner)
            .map_err(err)?;
        let workspace = self.domain.to_canonical_string();
        let mut after = None;
        if let Some(cursor) = input.get("cursor") {
            allowed(cursor, &["version", "workspace", "sequence"])?;
            let version = cursor["version"].as_u64().ok_or("INVALID")?;
            let domain = parse(&cursor["workspace"])?;
            let text = cursor["sequence"].as_str().ok_or("INVALID")?;
            let value = text.parse::<u64>().map_err(|_| "INVALID")?;
            if text != value.to_string() {
                return Err("INVALID".into());
            }
            if version == 1 && domain == self.domain && value <= sequence {
                after = Some(value);
            }
        }
        let cursor = json!({"version":1,"workspace":workspace,"sequence":sequence.to_string()});
        if after == Some(sequence) {
            return Ok(json!({"changed":false,"reset":false,"cursor":cursor}));
        }
        let reset = if let Some(after) = after {
            let notices = db
                .change_notices(&pin, self.domain, self.owner, after, 64)
                .map_err(err)?;
            notices.truncated
                || notices
                    .notices
                    .iter()
                    .any(|n| n.authority_changed || n.reset_required)
        } else {
            true
        };
        drop(db);
        // The stdio worker executes one command synchronously; the owned native
        // writer cannot mutate between these reads. Verify that invariant before
        // publishing any bundle. No Change command/objects cross source policy.
        let projection = json!({
            "snapshot":self.snapshot()?,
            "operations":self.operations()?,
            "desks":self.desks()?,
            "evidenceNetwork":self.evidence_network()?,
            "domainNetwork":self.domain_network()?
        });
        if self
            .db()?
            .domain_sequence(self.domain, self.owner)
            .map_err(err)?
            != sequence
            || projection["snapshot"]["sequence"].as_u64() != Some(sequence)
        {
            return Err("NATIVE_UNAVAILABLE".into());
        }
        let result = json!({"changed":true,"reset":reset,"cursor":cursor,"projection":projection});
        if result.to_string().len() > 8 * 1024 * 1024 {
            return Err("RESOURCE_LIMIT".into());
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn write(w: &Workspace, key: &str) -> Value {
        w.execute(json!({"op":"write","key":key,"payload":{"kind":"task","title":"Shared native task","description":"Synthetic synchronization fixture","status":"open","refs":[]}})).unwrap()
    }
    #[test]
    fn sync_bundle_is_coherent_unchanged_and_reopens_from_native_state() {
        let dir = tempfile::tempdir().unwrap();
        let w = Workspace::open(dir.path()).unwrap();
        let first = w.execute(json!({"op":"sync"})).unwrap();
        assert_eq!(first["changed"], true);
        assert_eq!(first["reset"], true);
        for (field, op) in [
            ("snapshot", "snapshot"),
            ("operations", "operations"),
            ("desks", "desks"),
            ("evidenceNetwork", "evidenceNetwork"),
            ("domainNetwork", "domainNetwork"),
        ] {
            assert_eq!(
                first["projection"][field],
                w.execute(json!({"op":op})).unwrap()
            );
        }
        let same = w
            .execute(json!({"op":"sync","cursor":first["cursor"]}))
            .unwrap();
        assert_eq!(same["changed"], false);
        assert!(same.get("projection").is_none());
        let result = write(&w, "11111111111111111111111111111111");
        let next = w
            .execute(json!({"op":"sync","cursor":first["cursor"]}))
            .unwrap();
        assert_eq!(next["changed"], true);
        assert_eq!(
            next["projection"]["snapshot"]["items"][0]["id"],
            result["id"]
        );
        assert_eq!(
            next["cursor"]["sequence"],
            next["projection"]["snapshot"]["sequence"]
                .as_u64()
                .unwrap()
                .to_string()
        );
        drop(w);
        let w = Workspace::open(dir.path()).unwrap();
        assert_eq!(
            w.execute(json!({"op":"sync","cursor":next["cursor"]}))
                .unwrap()["changed"],
            false
        );
        assert_eq!(
            w.execute(json!({"op":"sync"})).unwrap()["projection"],
            next["projection"]
        );
    }
    #[test]
    fn sync_foreign_future_and_version_cursors_reset_and_malformed_input_fails() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let w = Workspace::open(a.path()).unwrap();
        let other = Workspace::open(b.path()).unwrap();
        let first = w.execute(json!({"op":"sync"})).unwrap();
        assert_eq!(
            other
                .execute(json!({"op":"sync","cursor":first["cursor"]}))
                .unwrap()["reset"],
            true
        );
        for (field, value) in [
            ("version", json!(2)),
            ("sequence", json!("18446744073709551615")),
        ] {
            let mut cursor = first["cursor"].clone();
            cursor[field] = value;
            assert_eq!(
                w.execute(json!({"op":"sync","cursor":cursor})).unwrap()["reset"],
                true
            );
        }
        for value in [
            json!({"op":"sync","principal":"forged"}),
            json!({"op":"sync","cursor":{}}),
            json!({"op":"sync","cursor":null}),
        ] {
            assert_eq!(w.execute(value).unwrap_err(), "INVALID");
        }
        for seq in ["01", "-1", "1.0", "18446744073709551616"] {
            let mut cursor = first["cursor"].clone();
            cursor["sequence"] = json!(seq);
            assert_eq!(
                w.execute(json!({"op":"sync","cursor":cursor})).unwrap_err(),
                "INVALID"
            );
        }
    }
    #[test]
    fn sync_revalidates_source_policy_and_resets_bounded_backlog() {
        let dir = tempfile::tempdir().unwrap();
        let w = Workspace::open(dir.path()).unwrap();
        w.execute(json!({"op":"import","key":"22222222222222222222222222222222","original":"private text","payload":{"kind":"document","title":"secret.md","description":"","status":"open","refs":[]}})).unwrap();
        let before = w.execute(json!({"op":"sync"})).unwrap();
        assert_eq!(
            before["projection"]["snapshot"]["items"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let source = derive("USER-SELECTED-TEXT", &w.domain.0);
        let policy = derive("policy", &source.0);
        let revision = w
            .db()
            .unwrap()
            .revision_current(w.domain, w.owner, policy, None)
            .unwrap()
            .unwrap()
            .sequence;
        w.world()
            .unwrap()
            .set_policy(
                derive("deny", &source.0),
                Some(revision),
                Policy {
                    id: policy,
                    source,
                    purpose: PURPOSE,
                    epoch: 2,
                    allow_ingest: false,
                    allow_read: false,
                    evidence: b"Owner withdrew local read permission".to_vec(),
                },
            )
            .unwrap();
        let after = w
            .execute(json!({"op":"sync","cursor":before["cursor"]}))
            .unwrap();
        assert!(after["projection"]["snapshot"]["items"]
            .as_array()
            .unwrap()
            .is_empty());
        for n in 0..66u8 {
            write(&w, &derive("sync-fixture", &[n]).to_canonical_string());
        }
        let backlog = w
            .execute(json!({"op":"sync","cursor":after["cursor"]}))
            .unwrap();
        assert_eq!(backlog["reset"], true);
        assert_eq!(
            backlog["projection"]["snapshot"]["items"]
                .as_array()
                .unwrap()
                .len(),
            66
        );
    }
}
