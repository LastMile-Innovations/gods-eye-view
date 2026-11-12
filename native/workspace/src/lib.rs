//! Local product command adapter over Quanta's maintained native database and world ingestion.
//! The embedding transport authenticates the local owner; request JSON cannot select a principal.
use quanta_core::{
    Batch, Database, Epistemic, Error, Head, Mutation, Outcome, Qid, Query, Statement,
    Value as Native,
};
use quanta_world::{Import, ImportResult, Policy, WorldStore};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(test)]
use std::path::PathBuf;
use std::{
    cell::{Ref, RefCell, RefMut},
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};
const RECORDS: Qid = Qid(*b"NEIGHBOR_ROW__01");
const OCCURRENCES: Qid = Qid(*b"QWORLD_OCCUR__01");
const PURPOSE: Qid = Qid(*b"NEIGHBOR_USE__01");
const MAX_ORIGINAL: usize = 1024 * 1024;
fn derive(label: &str, data: &[u8]) -> Qid {
    let mut h = Sha256::new();
    h.update(label.as_bytes());
    h.update(data);
    let bytes = h.finalize();
    Qid(bytes[..16].try_into().expect("digest width"))
}
fn parse(v: &Value) -> Result<Qid, String> {
    Qid::parse(v.as_str().ok_or("INVALID")?).map_err(|_| "INVALID".into())
}
fn err(e: Error) -> String {
    match e {
        Error::Denied => "NOT_AVAILABLE",
        Error::Invalid(_) => "INVALID",
        Error::ResourceLimit(_) => "RESOURCE_LIMIT",
        _ => "NATIVE_UNAVAILABLE",
    }
    .into()
}
fn allowed(v: &Value, keys: &[&str]) -> Result<(), String> {
    let map = v.as_object().ok_or("INVALID")?;
    if map.keys().any(|k| !keys.contains(&k.as_str())) {
        return Err("INVALID".into());
    }
    Ok(())
}
fn receipt(out: Outcome, id: Qid) -> Result<Value, String> {
    match out {
        Outcome::Committed(r) => Ok(
            json!({"status":"committed","id":id.to_canonical_string(),"sequence":r.sequence,"receipt":r.transaction_digest.iter().map(|b|format!("{b:02x}")).collect::<String>()}),
        ),
        Outcome::Conflict => Err("CONFLICT".into()),
        Outcome::UnknownOutcome => Err("UNKNOWN_OUTCOME".into()),
        Outcome::Aborted(_) => Err("INVALID".into()),
    }
}
mod change_inbox;
mod citizen;
mod citizen_disclosure;
mod context;
mod domain;
mod drafts;
mod harness_policy;
mod lifecycle;
mod qeval;
mod qharness;
mod read_workflow;
mod sync;
pub struct Workspace {
    #[cfg(test)]
    root: PathBuf,
    domain: Qid,
    owner: Qid,
    session: RefCell<WorldStore>,
}
impl Workspace {
    pub fn open(root: &Path) -> Result<Self, String> {
        fs::create_dir_all(root).map_err(|_| "NATIVE_UNAVAILABLE")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(root, fs::Permissions::from_mode(0o700))
                .map_err(|_| "NATIVE_UNAVAILABLE")?;
        }
        let manifest = root.join("identity.json");
        if !manifest.exists() {
            if root.join("db").exists() {
                return Err("NATIVE_UNAVAILABLE".into());
            }
            let content = json!({"domain":Qid::generate().map_err(err)?.to_canonical_string(),"owner":Qid::generate().map_err(err)?.to_canonical_string()});
            let mut opts = OpenOptions::new();
            opts.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                opts.mode(0o600);
            }
            let mut file = opts.open(&manifest).map_err(|_| "NATIVE_UNAVAILABLE")?;
            file.write_all(content.to_string().as_bytes())
                .map_err(|_| "NATIVE_UNAVAILABLE")?;
            file.sync_all().map_err(|_| "NATIVE_UNAVAILABLE")?;
            fs::File::open(root)
                .and_then(|f| f.sync_all())
                .map_err(|_| "NATIVE_UNAVAILABLE")?;
        }
        let identity: Value =
            serde_json::from_slice(&fs::read(&manifest).map_err(|_| "NATIVE_UNAVAILABLE")?)
                .map_err(|_| "NATIVE_UNAVAILABLE")?;
        let domain = parse(&identity["domain"])?;
        let owner = parse(&identity["owner"])?;
        let (world, out) = WorldStore::initialize(
            root.join("db"),
            domain,
            owner,
            derive("bootstrap", &domain.0),
        )
        .map_err(err)?;
        receipt(out, domain)?;
        Ok(Self {
            #[cfg(test)]
            root: root.into(),
            domain,
            owner,
            session: RefCell::new(world),
        })
    }
    #[cfg(test)]
    fn path(&self) -> PathBuf {
        self.root.join("db")
    }
    fn db(&self) -> Result<Ref<'_, Database>, String> {
        self.session
            .try_borrow()
            .map(|world| Ref::map(world, WorldStore::database))
            .map_err(|_| "NATIVE_UNAVAILABLE".into())
    }
    fn db_mut(&self) -> Result<RefMut<'_, Database>, String> {
        self.session
            .try_borrow_mut()
            .map(|world| RefMut::map(world, WorldStore::database_mut))
            .map_err(|_| "NATIVE_UNAVAILABLE".into())
    }
    fn world(&self) -> Result<RefMut<'_, WorldStore>, String> {
        self.session
            .try_borrow_mut()
            .map_err(|_| "NATIVE_UNAVAILABLE".into())
    }
    fn validate_payload(&self, v: &Value, importing: bool) -> Result<(), String> {
        allowed(
            v,
            &[
                "kind",
                "title",
                "description",
                "status",
                "refs",
                "coordinates",
                "sourceRecord",
            ],
        )?;
        let kind = v["kind"].as_str().ok_or("INVALID")?;
        if !(if importing {
            &["document", "reference"][..]
        } else {
            &["place", "need", "mission", "task"][..]
        })
        .contains(&kind)
        {
            return Err("UNSUPPORTED".into());
        }
        let title = v["title"].as_str().ok_or("INVALID")?;
        if title.trim().is_empty()
            || title.chars().count() > 160
            || title.chars().any(|c| c.is_control())
        {
            return Err("INVALID".into());
        }
        if v["description"].as_str().is_none_or(|s| s.len() > 10000)
            || !["open", "done"].contains(&v["status"].as_str().ok_or("INVALID")?)
        {
            return Err("INVALID".into());
        }
        let refs = v["refs"].as_array().ok_or("INVALID")?;
        if refs.len() > 10 {
            return Err("RESOURCE_LIMIT".into());
        }
        if let Some(coords) = v.get("coordinates") {
            let a = coords.as_array().ok_or("INVALID")?;
            if a.len() != 2
                || a[0].as_f64().is_none_or(|x| !(-180.0..=180.0).contains(&x))
                || a[1].as_f64().is_none_or(|x| !(-90.0..=90.0).contains(&x))
            {
                return Err("INVALID".into());
            }
        }
        if kind == "place" && v.get("coordinates").is_none() {
            return Err("INVALID".into());
        }
        if let Some(id) = v.get("sourceRecord") {
            if kind != "reference" || id.as_str().is_none_or(|s| s.is_empty() || s.len() > 128) {
                return Err("INVALID".into());
            }
        }
        for reference in refs {
            let id = parse(reference)?;
            self.existing(id)?;
        }
        Ok(())
    }
    fn existing(&self, id: Qid) -> Result<(), String> {
        self.validate_any_ref(id)
    }
    pub fn execute(&self, input: Value) -> Result<Value, String> {
        match input["op"].as_str().ok_or("INVALID")? {
            "changeInbox" => {
                allowed(&input, &["op"])?;
                self.change_inbox()
            }
            "pollChangeInbox" => self.poll_change_inbox(input),
            "ackChangeInbox" => self.ack_change_inbox(input),
            "sync" => self.sync(input),
            "snapshot" => {
                allowed(&input, &["op"])?;
                self.snapshot()
            }
            "domainNetwork" => {
                allowed(&input, &["op"])?;
                self.domain_network()
            }
            "objectGraph" => self.object_graph(input),
            "worldTimeQuery" => self.world_time_query(input),
            "evaluateLicenseGate" => self.evaluate_license_gate(input),
            "saveMarketOffer" => self.save_market_offer(input),
            "saveProposal" => self.save_proposal(input),
            "saveCommitment" => self.save_commitment(input),
            "verifyCommitmentOutcome" => self.verify_commitment_outcome(input),
            "saveProject" => self.save_project(input),
            "saveSocialPost" => self.save_social_post(input),
            "compileAgentPlan" => self.compile_agent_plan(input),
            "executeAgentPlan" => self.execute_agent_plan(input),
            "seedStarterCatalog" => self.seed_starter_catalog(input),
            "qhModels" => self.qh_models(input),
            "qhCapabilities" => self.qh_capabilities(input),
            "qhOpenAiChatCompletions" => self.qh_openai_chat_completions(input),
            "qhOpenAiResponses" => self.qh_openai_responses(input),
            "qhOpenAiGetResponse" => self.qh_openai_get_response(input),
            "qhOpenAiCancelResponse" => self.qh_openai_cancel_response(input),
            "qhOpenAiEmbeddings" => self.qh_openai_embeddings(input),
            "qhCreateMandate" => self.qh_create_mandate(input),
            "qhRevokeMandate" => self.qh_revoke_mandate(input),
            "qhCompileFrame" => self.qh_compile_frame(input),
            "qhSaveMemory" => self.qh_save_memory(input),
            "qhSaveWorkflow" => self.qh_save_workflow(input),
            "qhValidateWorkflow" => self.qh_validate_workflow(input),
            "qhExecute" => self.qh_execute(input),
            "qhReconcileRun" => self.qh_reconcile_run(input),
            "qhCreateMission" => self.qh_create_mission(input),
            "qhMissionAction" => self.qh_mission_action(input),
            "qhRunEval" => self.qh_run_eval(input),
            "qhStatus" => self.qh_status(input),
            "deriveEvidenceText" => self.derive_evidence_text(input),
            "saveEvidenceDisclosure" => self.save_disclosure(input),
            "withdrawEvidenceDisclosure" => self.withdraw_disclosure(input),
            "evidenceDossier" => self.evidence_dossier(input),
            "citizenHistory" => self.citizen_history(input),
            "preserveEvidence" => self.preserve_evidence(input),
            "reviewEvidence" => self.review_evidence(input),
            "saveEvidenceClaim" => self.save_claim(input),
            "saveCasebook" => self.save_casebook(input),
            "evidenceNetwork" => {
                allowed(&input, &["op"])?;
                self.evidence_network()
            }
            "artifactOriginal" => self.artifact_original(input),
            "evidenceCustody" => self.evidence_custody(input),
            "drafts" => {
                allowed(&input, &["op"])?;
                self.drafts()
            }
            "draft" => self.draft_read(input),
            "saveDraft" => self.save_draft(input),
            "discardDraft" => self.discard_draft(input),
            "prepare" => self.prepare(input),
            "resume" => self.resume(input),
            "operations" => {
                allowed(&input, &["op"])?;
                self.operations()
            }
            "operation" => self.operation(input),
            "saveDesk" => self.save_desk(input),
            "deleteDesk" => self.delete_desk(input),
            "desks" => {
                allowed(&input, &["op"])?;
                self.desks()
            }
            "history" => self.history(input),
            "write" => self.write(input),
            "import" => self.import(input),
            "evidence" => {
                allowed(&input, &["op", "id"])?;
                let id = parse(&input["id"])?;
                let world = self.world()?;
                let occ = world.occurrence(id, PURPOSE).map_err(err)?;
                let original = world.original(id, PURPOSE).map_err(err)?;
                Ok(
                    json!({"id":id.to_canonical_string(),"original":String::from_utf8(original).map_err(|_|"INVALID")?,"source":occ.source.to_canonical_string(),"sourceVersion":occ.source_version.to_canonical_string(),"selector":occ.selector,"epistemic":"SourceClaimed","sourceVersionsVerified":false}),
                )
            }
            _ => Err("UNSUPPORTED".into()),
        }
    }
    fn snapshot(&self) -> Result<Value, String> {
        let db = self.db()?;
        let sequence = db.domain_sequence(self.domain, self.owner).map_err(err)?;
        let rows = db
            .query_current(
                self.domain,
                self.owner,
                &Query {
                    predicate: Some(RECORDS),
                    ..Query::default()
                },
            )
            .map_err(err)?;
        let occurrences = db
            .query_current(
                self.domain,
                self.owner,
                &Query {
                    predicate: Some(OCCURRENCES),
                    ..Query::default()
                },
            )
            .map_err(err)?;
        drop(db);
        let mut items = vec![];
        for row in rows {
            if let Some(s) = row.statement {
                let text = match s.value {
                    Native::Text(t) => Some(t),
                    Native::Map(mut m) => match m.remove("metadata") {
                        Some(Native::Text(t)) => Some(t),
                        _ => None,
                    },
                    _ => None,
                };
                if let Some(text) = text {
                    let payload: Value =
                        serde_json::from_str(&text).map_err(|_| "NATIVE_UNAVAILABLE")?;
                    items.push(json!({"id":s.id.to_canonical_string(),"revision":row.sequence,"payload":payload,"epistemic":"Authored"}));
                }
            }
        }
        let world = self.world()?;
        for row in occurrences {
            if let Some(statement) = row.statement {
                let occurrence = match world.occurrence(statement.id, PURPOSE) {
                    Ok(value) => value,
                    Err(Error::Denied) => continue,
                    Err(error) => return Err(err(error)),
                };
                if let Native::Text(text) = occurrence.claimed {
                    let payload: Value =
                        serde_json::from_str(&text).map_err(|_| "NATIVE_UNAVAILABLE")?;
                    items.push(json!({"id":occurrence.id.to_canonical_string(),"revision":occurrence.revision,"payload":payload,"epistemic":"SourceClaimed","source":occurrence.source.to_canonical_string(),"hasEvidence":true}));
                }
            }
        }
        drop(world);
        let visible: std::collections::BTreeSet<String> = items
            .iter()
            .filter_map(|v| v["id"].as_str().map(String::from))
            .collect();
        for item in &mut items {
            if let Some(refs) = item["payload"]["refs"].as_array_mut() {
                refs.retain(|id| {
                    id.as_str().is_some_and(|s| {
                        visible.contains(s)
                            || Qid::parse(s).is_ok_and(|qid| self.validate_any_ref(qid).is_ok())
                    })
                });
            }
        }
        if items.len() > 500 {
            return Err("RESOURCE_LIMIT".into());
        }
        items.sort_by_key(|v| std::cmp::Reverse(v["revision"].as_u64().unwrap_or(0)));
        Ok(
            json!({"workspace":self.domain.to_canonical_string(),"title":"My world","sequence":sequence,"items":items,"coverage":{"scope":"authorized-local-workspace","sourceVersionsVerified":false,"validTimeSupported":false}}),
        )
    }
    fn admit_new(&self, key: Qid) -> Result<(), String> {
        let db = self.db()?;
        if db
            .resolve(self.domain, self.owner, key)
            .map_err(err)?
            .is_some()
        {
            return Ok(());
        }
        let rec_count = db
            .query_current(
                self.domain,
                self.owner,
                &Query {
                    predicate: Some(RECORDS),
                    ..Query::default()
                },
            )
            .map_err(err)?
            .len();
        let occ_count = db
            .query_current(
                self.domain,
                self.owner,
                &Query {
                    predicate: Some(OCCURRENCES),
                    ..Query::default()
                },
            )
            .map_err(err)?
            .len();
        if rec_count + occ_count >= 500 {
            return Err("RESOURCE_LIMIT".into());
        }
        Ok(())
    }
    fn write(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "key", "id", "expected", "payload"])?;
        let key = parse(&input["key"])?;
        let resolved = self
            .db()?
            .resolve(self.domain, self.owner, key)
            .map_err(err)?
            .is_some();
        if !resolved {
            self.validate_payload(&input["payload"], false)?;
        }
        let id = if input.get("id").is_some() {
            parse(&input["id"])?
        } else {
            derive("record", &key.0)
        };
        let expected = if input.get("id").is_some() {
            Some(input["expected"].as_u64().ok_or("INVALID")?)
        } else {
            if input.get("expected").is_some() {
                return Err("INVALID".into());
            }
            None
        };
        if expected.is_none() && !resolved {
            self.admit_new(key)?;
        }
        let mut roles = Vec::new();
        if let Some(refs) = input["payload"].get("refs").and_then(Value::as_array) {
            for r in refs {
                if let Ok(target) = parse(r) {
                    roles.push((domain::ROLE_LINK, target));
                }
            }
        }
        let mut db = self.db_mut()?;
        if expected.is_some() && !resolved {
            let row = db
                .revision_current(self.domain, self.owner, id, None)
                .map_err(err)?
                .and_then(|r| r.statement)
                .ok_or("NOT_AVAILABLE")?;
            let old = match &row.value {
                Native::Text(s) => s.as_str(),
                Native::Map(m) => match m.get("metadata") {
                    Some(Native::Text(s)) => s.as_str(),
                    _ => return Err("INVALID".into()),
                },
                _ => return Err("INVALID".into()),
            };
            let previous: Value = serde_json::from_str(old).map_err(|_| "NATIVE_UNAVAILABLE")?;
            if row.predicate != RECORDS || previous["kind"] != input["payload"]["kind"] {
                return Err("INVALID".into());
            }
        }
        let mut stmt = lifecycle::statement(id, RECORDS, &input["payload"]);
        stmt.roles = roles;
        let out = db.commit(Batch {
            domain: self.domain,
            principal: self.owner,
            key,
            heads: vec![Head {
                statement: id,
                expected,
            }],
            mutations: vec![Mutation::Put(stmt)],
            content: vec![],
        });
        receipt(out, id)
    }
    fn import(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "key", "payload", "original", "selector"])?;
        let key = parse(&input["key"])?;
        let resolved = self
            .db()?
            .resolve(self.domain, self.owner, key)
            .map_err(err)?
            .is_some();
        if !resolved {
            self.validate_payload(&input["payload"], true)?;
        }
        let original = input["original"]
            .as_str()
            .ok_or("INVALID")?
            .as_bytes()
            .to_vec();
        if original.len() > MAX_ORIGINAL {
            return Err("RESOURCE_LIMIT".into());
        }
        if !resolved {
            self.admit_new(key)?;
        }
        let public = input["payload"]["kind"] == "reference";
        let source = derive(
            if public {
                "USGS-EARTHQUAKES"
            } else {
                "USER-SELECTED-TEXT"
            },
            &self.domain.0,
        );
        let policy = derive("policy", &source.0);
        let db = self.db()?;
        let prior = db
            .revision_current(self.domain, self.owner, policy, None)
            .map_err(err)?
            .map(|r| r.sequence);
        drop(db);
        let mut world = self.world()?;
        let revision = if let Some(r) = prior {
            r
        } else {
            let result=world.set_policy(derive("policy-admit",&source.0),None,Policy{id:policy,source,purpose:PURPOSE,epoch:1,allow_ingest:true,allow_read:true,evidence:if public{b"Local retention of USGS earthquake GeoJSON; USGS source attribution retained; claim not independently verified.".to_vec()}else{b"Owner explicitly confirmed permission to retain selected UTF-8 file locally; no permission for publication or third-party disclosure.".to_vec()}}).map_err(err)?;
            receipt(result, policy)?["sequence"]
                .as_u64()
                .ok_or("NATIVE_UNAVAILABLE")?
        };
        let id = derive("occurrence", &key.0);
        let selector = input.get("selector").and_then(Value::as_str).unwrap_or("");
        if selector.len() > 200 {
            return Err("INVALID".into());
        }
        let result = world
            .import(
                key,
                Import {
                    occurrence: id,
                    admission: derive("admission", &key.0),
                    policy,
                    policy_revision: revision,
                    purpose: PURPOSE,
                    source_version: derive("source-version", &original),
                    record_key: id.to_canonical_string(),
                    selector: selector.into(),
                    original,
                    claimed: Native::Text(input["payload"].to_string()),
                },
            )
            .map_err(err)?;
        match result {
            ImportResult::Committed {
                receipt: r,
                occurrence,
                ..
            } => receipt(Outcome::Committed(r), occurrence),
            ImportResult::Conflict => Err("CONFLICT".into()),
            ImportResult::Aborted(_) => Err("INVALID".into()),
            ImportResult::UnknownOutcome => Err("UNKNOWN_OUTCOME".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_grant_revocation_and_export_restore_preserve_authority_and_originals() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("original");
        let store = Workspace::open(&root).unwrap();
        let input = json!({"op":"import","key":"11111111111111111111111111111111","payload":{"kind":"document","title":"private.md","description":"","status":"open","refs":[]},"original":"exact original\n"});
        let result = store.execute(input).unwrap();
        let other = Qid::generate().unwrap();
        let mut db = store.db_mut().unwrap();
        assert!(matches!(
            db.query_current(store.domain, other, &Query::default()),
            Err(Error::Denied)
        ));
        receipt(
            db.commit(Batch {
                domain: store.domain,
                principal: store.owner,
                key: Qid::generate().unwrap(),
                heads: vec![],
                mutations: vec![Mutation::Grant {
                    principal: other,
                    read: true,
                    write: false,
                }],
                content: vec![],
            }),
            other,
        )
        .unwrap();
        assert!(db
            .query_current(store.domain, other, &Query::default())
            .is_ok());
        receipt(
            db.commit(Batch {
                domain: store.domain,
                principal: store.owner,
                key: Qid::generate().unwrap(),
                heads: vec![],
                mutations: vec![Mutation::Revoke(other)],
                content: vec![],
            }),
            other,
        )
        .unwrap();
        assert!(matches!(
            db.query_current(store.domain, other, &Query::default()),
            Err(Error::Denied)
        ));
        let backup = temp.path().join("backup");
        db.export(&backup).unwrap();
        drop(db);
        let restored_root = temp.path().join("restored");
        fs::create_dir(&restored_root).unwrap();
        fs::copy(
            root.join("identity.json"),
            restored_root.join("identity.json"),
        )
        .unwrap();
        drop(Database::restore(&backup, restored_root.join("db")).unwrap());
        let restored = Workspace::open(&restored_root).unwrap();
        assert_eq!(
            restored
                .execute(json!({"op":"evidence","id":result["id"]}))
                .unwrap()["original"],
            "exact original\n"
        );
        let world = WorldStore::open(store.path(), store.domain, other);
        assert!(world.is_err());
        let source = derive("USER-SELECTED-TEXT", &store.domain.0);
        let policy = derive("policy", &source.0);
        let db = store.db().unwrap();
        let revision = db
            .revision_current(store.domain, store.owner, policy, None)
            .unwrap()
            .unwrap()
            .sequence;
        drop(db);
        let mut world = store.world().unwrap();
        world
            .set_policy(
                Qid::generate().unwrap(),
                Some(revision),
                Policy {
                    id: policy,
                    source,
                    purpose: PURPOSE,
                    epoch: 2,
                    allow_ingest: false,
                    allow_read: false,
                    evidence: b"owner revoked".to_vec(),
                },
            )
            .unwrap();
        drop(world);
        assert_eq!(
            store
                .execute(json!({"op":"evidence","id":result["id"]}))
                .unwrap_err(),
            "NOT_AVAILABLE"
        );
        assert_eq!(
            store.execute(json!({"op":"snapshot"})).unwrap()["items"],
            json!([])
        );
    }
}
