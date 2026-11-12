//! Non-destructive local text redaction and explicit, revision-pinned disclosure.
use super::citizen::{hex, now_ms, original_bytes, text, ARTIFACTS, CASEBOOKS, CLAIMS};
use super::*;
const DISCLOSURES: Qid = Qid(*b"CITIZEN_DISC__01");
fn pin(v: &Value) -> Result<(Qid, u64), String> {
    allowed(v, &["id", "revision"])?;
    Ok((parse(&v["id"])?, v["revision"].as_u64().ok_or("INVALID")?))
}
impl Workspace {
    pub(super) fn validate_disclosure_command(&self, v: &Value) -> Result<(), String> {
        parse(&v["key"])?;
        match v["op"].as_str().ok_or("INVALID")? {
            "deriveEvidenceText" => {
                allowed(
                    v,
                    &["op", "key", "parent", "expected", "title", "ranges", "note"],
                )?;
                parse(&v["parent"])?;
                v["expected"].as_u64().ok_or("INVALID")?;
                text(&v["title"], 1, 160)?;
                text(&v["note"], 1, 4000)?;
                let spans = v["ranges"].as_array().ok_or("INVALID")?;
                if spans.is_empty() || spans.len() > 128 {
                    return Err("INVALID".into());
                }
                for range in spans {
                    let r = range.as_array().ok_or("INVALID")?;
                    if r.len() != 2 || r.iter().any(|n| n.as_u64().is_none()) {
                        return Err("INVALID".into());
                    }
                }
            }
            "saveEvidenceDisclosure" => {
                allowed(v, &["op", "key", "payload"])?;
                let p = &v["payload"];
                allowed(
                    p,
                    &[
                        "title",
                        "scope",
                        "approvalConfirmed",
                        "casebook",
                        "artifacts",
                        "claims",
                    ],
                )?;
                text(&p["title"], 1, 160)?;
                if p["scope"] != "local-download" || p["approvalConfirmed"] != true {
                    return Err("INVALID".into());
                }
                pin(&p["casebook"])?;
                for (name, cap) in [("artifacts", 32), ("claims", 16)] {
                    let refs = p[name].as_array().ok_or("INVALID")?;
                    if refs.len() > cap || (name == "artifacts" && refs.is_empty()) {
                        return Err("INVALID".into());
                    }
                    let mut seen = std::collections::BTreeSet::new();
                    for r in refs {
                        if !seen.insert(pin(r)?.0) {
                            return Err("INVALID".into());
                        }
                    }
                }
            }
            "withdrawEvidenceDisclosure" => {
                allowed(v, &["op", "key", "id", "expected", "note"])?;
                parse(&v["id"])?;
                v["expected"].as_u64().ok_or("INVALID")?;
                text(&v["note"], 1, 4000)?;
            }
            _ => return Err("UNSUPPORTED".into()),
        }
        Ok(())
    }
    pub(super) fn derive_evidence_text(&self, input: Value) -> Result<Value, String> {
        if let Some(saved) = self.cen_prior(&input)? {
            return Ok(saved);
        }
        self.validate_disclosure_command(&input)?;
        let parent = parse(&input["parent"])?;
        let (revision, p) = self.cen_row(parent, ARTIFACTS)?;
        if Some(revision) != input["expected"].as_u64() {
            return Err("CONFLICT".into());
        }
        if p["mediaType"] != "text/plain" {
            return Err("UNSUPPORTED".into());
        }
        let source =
            self.artifact_original(json!({"op":"artifactOriginal","id":input["parent"]}))?;
        let bytes = original_bytes(&source["bytes"])?;
        let original = std::str::from_utf8(&bytes).map_err(|_| "INVALID")?;
        let mut out = String::new();
        let mut offset = 0;
        for r in input["ranges"].as_array().ok_or("INVALID")? {
            let start = usize::try_from(r[0].as_u64().ok_or("INVALID")?).map_err(|_| "INVALID")?;
            let end = usize::try_from(r[1].as_u64().ok_or("INVALID")?).map_err(|_| "INVALID")?;
            if start < offset
                || start >= end
                || end > bytes.len()
                || !original.is_char_boundary(start)
                || !original.is_char_boundary(end)
            {
                return Err("INVALID".into());
            }
            out.push_str(&original[offset..start]);
            out.push_str("[REDACTED]");
            offset = end;
        }
        out.push_str(&original[offset..]);
        if out.len() > MAX_ORIGINAL || self.metadata(ARTIFACTS)?.len() >= 256 {
            return Err("RESOURCE_LIMIT".into());
        }
        let bytes = out.into_bytes();
        let digest = quanta_core::hash(&bytes);
        let value = json!({"title":input["title"],"fileName":"redacted.txt","mediaType":"text/plain","family":"04","sourceType":"received_copy","originGroup":p["originGroup"],"dependsOn":input["parent"],"notes":input["note"],"assertedCapturedAt":null,"coordinates":null,"lifecycle":"preserved","scope":"private-local-owner","serverRecordedAtMs":now_ms()?,"byteLength":bytes.len(),"integrity":{"nativeContent":digest,"sha256":hex(&digest),"blake3":blake3::hash(&bytes).to_hex().to_string(),"factualVerification":false},"transformation":{"profile":"utf8-byte-redaction-v1","parentRevision":revision,"parentSha256":p["integrity"]["sha256"],"ranges":input["ranges"],"replacement":"[REDACTED]"}});
        self.cen_commit(
            &input,
            (derive("citizen-derived", &parse(&input["key"])?.0), None),
            ARTIFACTS,
            &value,
            Some(bytes),
            Some("text-redaction-created"),
        )
    }
    fn pinned(&self, v: &Value, predicate: Qid) -> Result<Value, String> {
        let (id, revision) = pin(v)?;
        let (current, p) = self.cen_row(id, predicate)?;
        if current != revision {
            return Err("CONFLICT".into());
        }
        Ok(p)
    }
    fn disclosure_ancestors(&self, artifacts: &Value) -> Result<Value, String> {
        let mut ancestors = std::collections::BTreeMap::new();
        for a in artifacts.as_array().ok_or("INVALID")? {
            let mut id = pin(a)?.0;
            let mut seen = std::collections::BTreeSet::new();
            loop {
                if !seen.insert(id) || seen.len() > 256 {
                    return Err("NATIVE_UNAVAILABLE".into());
                }
                let (revision, p) = self.cen_row(id, ARTIFACTS)?;
                if p["lifecycle"] == "restricted" || p["lifecycle"] == "archived" {
                    return Err("INVALID".into());
                }
                ancestors.insert(id.to_canonical_string(), revision);
                if p["dependsOn"].is_null() {
                    break;
                }
                id = parse(&p["dependsOn"])?;
            }
        }
        Ok(json!(ancestors))
    }
    // Exact selected citations take precedence. Ancestor citations need one unique selected descendant.
    fn citation_indexes(
        &self,
        selected: &Value,
    ) -> Result<std::collections::BTreeMap<String, Option<usize>>, String> {
        let mut indexes = std::collections::BTreeMap::new();
        let entries = selected.as_array().ok_or("INVALID")?;
        for (index, a) in entries.iter().enumerate() {
            let mut id = pin(a)?.0;
            let mut seen = std::collections::BTreeSet::new();
            loop {
                if !seen.insert(id) || seen.len() > 256 {
                    return Err("NATIVE_UNAVAILABLE".into());
                }
                indexes
                    .entry(id.to_canonical_string())
                    .and_modify(|prior| {
                        if *prior != Some(index) {
                            *prior = None;
                        }
                    })
                    .or_insert(Some(index));
                let (_, p) = self.cen_row(id, ARTIFACTS)?;
                if p["dependsOn"].is_null() {
                    break;
                }
                id = parse(&p["dependsOn"])?;
            }
        }
        for (index, a) in entries.iter().enumerate() {
            indexes.insert(a["id"].as_str().ok_or("INVALID")?.to_owned(), Some(index));
        }
        Ok(indexes)
    }
    fn check_disclosure(&self, p: &Value) -> Result<(), String> {
        if p["state"] != "approved" {
            return Err("NOT_AVAILABLE".into());
        }
        self.pinned(&p["casebook"], CASEBOOKS)?;
        for a in p["artifacts"].as_array().ok_or("NATIVE_UNAVAILABLE")? {
            self.pinned(a, ARTIFACTS)?;
        }
        for c in p["claims"].as_array().ok_or("NATIVE_UNAVAILABLE")? {
            self.pinned(c, CLAIMS)?;
        }
        // A change to any current ancestor invalidates this approval, including a restriction.
        for (id, rev) in p["ancestorRevisions"]
            .as_object()
            .ok_or("NATIVE_UNAVAILABLE")?
        {
            if self.cen_row(parse(&json!(id))?, ARTIFACTS)?.0
                != rev.as_u64().ok_or("NATIVE_UNAVAILABLE")?
            {
                return Err("CONFLICT".into());
            }
        }
        if self.disclosure_ancestors(&p["artifacts"])? != p["ancestorRevisions"] {
            return Err("CONFLICT".into());
        }
        Ok(())
    }
    pub(super) fn save_disclosure(&self, input: Value) -> Result<Value, String> {
        if let Some(saved) = self.cen_prior(&input)? {
            return Ok(saved);
        }
        self.validate_disclosure_command(&input)?;
        if self.metadata(DISCLOSURES)?.len() >= 64 {
            return Err("RESOURCE_LIMIT".into());
        }
        let mut p = input["payload"].clone();
        let b = self.pinned(&p["casebook"], CASEBOOKS)?;
        let selected = self.citation_indexes(&p["artifacts"])?;
        let mut size = 0u64;
        for a in p["artifacts"].as_array().ok_or("INVALID")? {
            let value = self.pinned(a, ARTIFACTS)?;
            if value["transformation"]["profile"] != "utf8-byte-redaction-v1"
                || value["lifecycle"] != "under_review"
                || !b["artifacts"]
                    .as_array()
                    .ok_or("NATIVE_UNAVAILABLE")?
                    .contains(&a["id"])
            {
                return Err("INVALID".into());
            }
            size = size
                .checked_add(value["byteLength"].as_u64().ok_or("NATIVE_UNAVAILABLE")?)
                .ok_or("RESOURCE_LIMIT")?;
        }
        if size > MAX_ORIGINAL as u64 {
            return Err("RESOURCE_LIMIT".into());
        }
        for c in p["claims"].as_array().ok_or("INVALID")? {
            let claim = self.pinned(c, CLAIMS)?;
            if !b["claims"]
                .as_array()
                .ok_or("NATIVE_UNAVAILABLE")?
                .contains(&c["id"])
            {
                return Err("INVALID".into());
            }
            for direction in ["supporting", "contradicting"] {
                for id in claim[direction].as_array().ok_or("NATIVE_UNAVAILABLE")? {
                    if selected
                        .get(id.as_str().ok_or("NATIVE_UNAVAILABLE")?)
                        .copied()
                        .flatten()
                        .is_none()
                    {
                        return Err("INVALID".into());
                    }
                }
            }
        }
        p["ancestorRevisions"] = self.disclosure_ancestors(&p["artifacts"])?;
        p["state"] = json!("approved");
        p["serverRecordedAtMs"] = json!(now_ms()?);
        self.cen_commit(
            &input,
            (derive("citizen-disclosure", &parse(&input["key"])?.0), None),
            DISCLOSURES,
            &p,
            None,
            None,
        )
    }
    pub(super) fn withdraw_disclosure(&self, input: Value) -> Result<Value, String> {
        if let Some(saved) = self.cen_prior(&input)? {
            return Ok(saved);
        }
        self.validate_disclosure_command(&input)?;
        let id = parse(&input["id"])?;
        let (_, mut p) = self.cen_row(id, DISCLOSURES)?;
        if p["state"] != "approved" {
            return Err("INVALID".into());
        }
        p["state"] = json!("withdrawn");
        p["withdrawalNote"] = input["note"].clone();
        self.cen_commit(
            &input,
            (id, input["expected"].as_u64()),
            DISCLOSURES,
            &p,
            None,
            None,
        )
    }
    pub(super) fn disclosure_summaries(&self) -> Result<Vec<Value>, String> {
        let mut rows = self.metadata(DISCLOSURES)?;
        rows.sort_by_key(|r| std::cmp::Reverse(r.1));
        rows.into_iter().map(|(id,revision,p)|{let readiness=match self.check_disclosure(&p){Ok(())=>"ready",Err(ref e) if e=="CONFLICT"=>"stale",Err(ref e) if e=="NOT_AVAILABLE"=>"withdrawn",Err(ref e) if e=="INVALID"=>"blocked",Err(e)=>return Err(e)};Ok(json!({"id":id.to_canonical_string(),"revision":revision,"payload":p,"readiness":readiness}))}).collect()
    }
    pub(super) fn evidence_dossier(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "id"])?;
        let (_, p) = self.cen_row(parse(&input["id"])?, DISCLOSURES)?;
        self.check_disclosure(&p)?;
        let mut artifacts = vec![];
        let indexes = self.citation_indexes(&p["artifacts"])?;
        for a in p["artifacts"].as_array().ok_or("NATIVE_UNAVAILABLE")? {
            let row = self.pinned(a, ARTIFACTS)?;
            let source = self.artifact_original(json!({"op":"artifactOriginal","id":a["id"]}))?;
            let bytes = original_bytes(&source["bytes"])?;
            artifacts.push(json!({"label":row["title"],"fileName":"redacted.txt","mediaType":"text/plain","sha256":source["sha256"],"blake3":source["blake3"],"text":String::from_utf8(bytes).map_err(|_|"NATIVE_UNAVAILABLE")?}));
        }
        let mut claims = vec![];
        for c in p["claims"].as_array().ok_or("NATIVE_UNAVAILABLE")? {
            let row = self.pinned(c, CLAIMS)?;
            let refs = |direction: &str| -> Result<Vec<usize>, String> {
                row[direction]
                    .as_array()
                    .ok_or("NATIVE_UNAVAILABLE")?
                    .iter()
                    .map(|id| {
                        indexes
                            .get(id.as_str().ok_or("NATIVE_UNAVAILABLE")?)
                            .copied()
                            .flatten()
                            .ok_or_else(|| "NATIVE_UNAVAILABLE".into())
                    })
                    .collect()
            };
            claims.push(json!({"text":row["text"],"status":row["status"],"rationale":row["rationale"],"supporting":refs("supporting")?,"contradicting":refs("contradicting")?,"assessment":"human-reviewed-local-owner","automaticallyVerified":false}));
        }
        Ok(
            json!({"format":"neighbor-evidence-dossier-v1","title":p["title"],"scope":"local-download","artifacts":artifacts,"claims":claims,"notice":"Selected text derivatives and reviewer assertions. Integrity is not factual verification. Downloaded copies cannot be revoked."}),
        )
    }
    pub(super) fn citizen_history(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "id", "before", "limit"])?;
        let id = parse(&input["id"])?;
        let db = self.db()?;
        let now = db.domain_sequence(self.domain, self.owner).map_err(err)?;
        let mut before = input
            .get("before")
            .map(|n| n.as_u64().ok_or("INVALID"))
            .transpose()?
            .unwrap_or(now);
        let limit = input
            .get("limit")
            .map(|n| n.as_u64().ok_or("INVALID"))
            .transpose()?
            .unwrap_or(20);
        if before > now || limit == 0 || limit > 50 {
            return Err("INVALID".into());
        }
        let current = db
            .revision_current(self.domain, self.owner, id, None)
            .map_err(err)?
            .ok_or("NOT_AVAILABLE")?;
        let predicate = current.statement.ok_or("NOT_AVAILABLE")?.predicate;
        if ![ARTIFACTS, CLAIMS, CASEBOOKS, DISCLOSURES].contains(&predicate) {
            return Err("NOT_AVAILABLE".into());
        }
        let mut items = vec![];
        while before > 0 && items.len() < limit as usize {
            let Some(row) = db
                .revision_current(self.domain, self.owner, id, Some(before))
                .map_err(err)?
            else {
                break;
            };
            let revision = row.sequence;
            let st = row.statement.ok_or("NOT_AVAILABLE")?;
            if st.predicate != predicate {
                return Err("NATIVE_UNAVAILABLE".into());
            }
            let value = match st.value {
                Native::Text(t) => t,
                Native::Map(mut m) => match m.remove("metadata") {
                    Some(Native::Text(t)) => t,
                    _ => return Err("NATIVE_UNAVAILABLE".into()),
                },
                _ => return Err("NATIVE_UNAVAILABLE".into()),
            };
            let payload: Value = serde_json::from_str(&value).map_err(|_| "NATIVE_UNAVAILABLE")?;
            items.push(json!({"revision":revision,"payload":payload}));
            before = revision.saturating_sub(1);
        }
        let truncated = before > 0
            && db
                .revision_current(self.domain, self.owner, id, Some(before))
                .map_err(err)?
                .is_some();
        Ok(
            json!({"id":input["id"],"items":items,"truncated":truncated,"nextBefore":if truncated{Some(before)}else{None},"validTimeSupported":false,"scope":"authorized-as-known-native-revisions"}),
        )
    }
}
