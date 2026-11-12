//! Private local Citizen Evidence foundation. Integrity is separate from factual review.
use super::lifecycle::{fingerprint, statement};
use super::*;
pub(super) const ARTIFACTS: Qid = Qid(*b"CITIZEN_ARTIFACT");
pub(super) const CLAIMS: Qid = Qid(*b"CITIZEN_CLAIM__1");
pub(super) const CASEBOOKS: Qid = Qid(*b"CITIZEN_CASEBK01");
const CUSTODY: Qid = Qid(*b"CITIZEN_CUSTODY1");
const ADMISSIONS: Qid = Qid(*b"CITIZEN_ADMIT__1");
pub(super) fn now_ms() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "NATIVE_UNAVAILABLE".into())
        .map(|d| d.as_millis() as u64)
}
pub(super) fn text(v: &Value, min: usize, max: usize) -> Result<&str, String> {
    let s = v.as_str().ok_or("INVALID")?;
    if s.trim().len() < min || s.len() > max {
        return Err("INVALID".into());
    }
    Ok(s)
}
pub(super) fn original_bytes(v: &Value) -> Result<Vec<u8>, String> {
    let list = v.as_array().ok_or("INVALID")?;
    if list.len() > MAX_ORIGINAL {
        return Err("RESOURCE_LIMIT".into());
    }
    list.iter()
        .map(|v| {
            v.as_u64()
                .and_then(|n| u8::try_from(n).ok())
                .ok_or("INVALID".into())
        })
        .collect()
}
pub(super) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
impl Workspace {
    pub(super) fn cen_row(&self, id: Qid, predicate: Qid) -> Result<(u64, Value), String> {
        let row = self
            .db()?
            .revision_current(self.domain, self.owner, id, None)
            .map_err(err)?
            .ok_or("NOT_AVAILABLE")?;
        let statement = row.statement.ok_or("NOT_AVAILABLE")?;
        if statement.predicate != predicate {
            return Err("NOT_AVAILABLE".into());
        }
        let value = match statement.value {
            Native::Text(s) => s,
            Native::Map(mut m) => match m.remove("metadata") {
                Some(Native::Text(s)) => s,
                _ => return Err("NATIVE_UNAVAILABLE".into()),
            },
            _ => return Err("NATIVE_UNAVAILABLE".into()),
        };
        Ok((
            row.sequence,
            serde_json::from_str(&value).map_err(|_| "NATIVE_UNAVAILABLE")?,
        ))
    }
    pub(super) fn cen_prior(&self, input: &Value) -> Result<Option<Value>, String> {
        let key = parse(&input["key"])?;
        let prior = self
            .db()?
            .resolve(self.domain, self.owner, key)
            .map_err(err)?;
        if let Some(saved) = prior {
            let (_, admission) = self.cen_row(derive("citizen-admit", &key.0), ADMISSIONS)?;
            if admission["requestHash"] != fingerprint(input) {
                return Err("INVALID".into());
            }
            return Ok(Some(receipt(
                Outcome::Committed(saved),
                parse(&admission["resultId"])?,
            )?));
        }
        Ok(None)
    }
    pub(super) fn cen_commit(
        &self,
        input: &Value,
        head: (Qid, Option<u64>),
        predicate: Qid,
        value: &Value,
        original: Option<Vec<u8>>,
        custody: Option<&str>,
    ) -> Result<Value, String> {
        let (id, expected) = head;
        let key = parse(&input["key"])?;
        let admission = derive("citizen-admit", &key.0);
        let mut row = statement(id, predicate, value);
        if predicate == ARTIFACTS {
            let hash = value["integrity"]["nativeContent"]
                .as_array()
                .ok_or("NATIVE_UNAVAILABLE")?;
            let mut digest = [0u8; 32];
            if hash.len() != 32 {
                return Err("NATIVE_UNAVAILABLE".into());
            }
            for (i, b) in hash.iter().enumerate() {
                digest[i] = b
                    .as_u64()
                    .and_then(|n| u8::try_from(n).ok())
                    .ok_or("NATIVE_UNAVAILABLE")?;
            }
            row.value = Native::Map(std::collections::BTreeMap::from([
                ("metadata".into(), Native::Text(value.to_string())),
                ("original".into(), Native::Content(digest)),
            ]));
        }
        let mut mutations = vec![
            Mutation::Put(row),
            Mutation::Put(statement(
                admission,
                ADMISSIONS,
                &json!({"requestHash":fingerprint(input),"resultId":id.to_canonical_string()}),
            )),
        ];
        if let Some(action) = custody {
            let event_id = derive("citizen-custody", &key.0);
            let mut event = statement(
                event_id,
                CUSTODY,
                &json!({"artifact":id.to_canonical_string(),"action":action,"state":value["lifecycle"],"note":input["note"],"serverRecordedAtMs":now_ms()?,"sha256":value["integrity"]["sha256"]}),
            );
            event.subject = id;
            mutations.push(Mutation::Put(event));
        }
        receipt(
            self.db_mut()?.commit(Batch {
                domain: self.domain,
                principal: self.owner,
                key,
                heads: vec![
                    Head {
                        statement: id,
                        expected,
                    },
                    Head {
                        statement: admission,
                        expected: None,
                    },
                ],
                mutations,
                content: original.into_iter().collect(),
            }),
            id,
        )
    }
    pub(super) fn validate_cen_command(&self, input: &Value) -> Result<(), String> {
        parse(&input["key"])?;
        match input["op"].as_str().ok_or("INVALID")? {
            "preserveEvidence" => {
                allowed(
                    input,
                    &["op", "key", "permissionConfirmed", "bytes", "payload"],
                )?;
                if input["permissionConfirmed"] != true {
                    return Err("INVALID".into());
                }
                original_bytes(&input["bytes"])?;
                let p = &input["payload"];
                allowed(
                    p,
                    &[
                        "title",
                        "fileName",
                        "mediaType",
                        "family",
                        "sourceType",
                        "originGroup",
                        "dependsOn",
                        "notes",
                        "assertedCapturedAt",
                        "coordinates",
                    ],
                )?;
                for name in ["title", "fileName", "mediaType"] {
                    let s = text(&p[name], 1, 160)?;
                    if s.chars().any(char::is_control) {
                        return Err("INVALID".into());
                    }
                }
                if p["fileName"]
                    .as_str()
                    .is_some_and(|s| s.contains('/') || s.contains('\\'))
                {
                    return Err("INVALID".into());
                }
                let family = text(&p["family"], 2, 2)?
                    .parse::<u8>()
                    .map_err(|_| "INVALID")?;
                if !(1..=16).contains(&family) {
                    return Err("INVALID".into());
                }
                if !["firsthand", "received_copy", "unknown"]
                    .contains(&p["sourceType"].as_str().ok_or("INVALID")?)
                {
                    return Err("INVALID".into());
                }
                text(&p["originGroup"], 0, 120)?;
                text(&p["notes"], 0, 10000)?;
                if !p["assertedCapturedAt"].is_null() {
                    text(&p["assertedCapturedAt"], 1, 160)?;
                }
                if !p["dependsOn"].is_null() {
                    self.cen_row(parse(&p["dependsOn"])?, ARTIFACTS)?;
                }
                if !p["coordinates"].is_null() {
                    let c = p["coordinates"].as_array().ok_or("INVALID")?;
                    if c.len() != 2
                        || c[0].as_f64().is_none_or(|n| !(-180.0..=180.0).contains(&n))
                        || c[1].as_f64().is_none_or(|n| !(-90.0..=90.0).contains(&n))
                    {
                        return Err("INVALID".into());
                    }
                }
            }
            "reviewEvidence" => {
                allowed(
                    input,
                    &["op", "key", "id", "expected", "state", "note", "dimensions"],
                )?;
                parse(&input["id"])?;
                input["expected"].as_u64().ok_or("INVALID")?;
                text(&input["note"], 1, 4000)?;
                if let Some(dimensions) = input.get("dimensions") {
                    let names = [
                        "integrity",
                        "origin",
                        "time",
                        "location",
                        "content",
                        "corroboration",
                    ];
                    allowed(dimensions, &names)?;
                    for name in names {
                        let item = &dimensions[name];
                        allowed(item, &["assessment", "notes"])?;
                        if !["not_assessed", "supported", "uncertain", "contradicted"]
                            .contains(&item["assessment"].as_str().ok_or("INVALID")?)
                        {
                            return Err("INVALID".into());
                        }
                        text(&item["notes"], 0, 2000)?;
                    }
                }

                if ![
                    "preserved",
                    "needs_context",
                    "under_review",
                    "disputed",
                    "restricted",
                    "archived",
                ]
                .contains(&input["state"].as_str().ok_or("INVALID")?)
                {
                    return Err("UNSUPPORTED".into());
                }
            }
            "saveEvidenceClaim" => {
                allowed(input, &["op", "key", "id", "expected", "payload"])?;
                let p = &input["payload"];
                allowed(
                    p,
                    &[
                        "text",
                        "status",
                        "supporting",
                        "contradicting",
                        "rationale",
                        "independenceAttested",
                    ],
                )?;
                text(&p["text"], 1, 10000)?;
                text(&p["rationale"], 1, 4000)?;
                if p["independenceAttested"].as_bool().is_none()
                    || !["unverified", "disputed", "corroborated", "refuted"]
                        .contains(&p["status"].as_str().ok_or("INVALID")?)
                {
                    return Err("INVALID".into());
                }
                self.cen_refs(&p["supporting"], ARTIFACTS, 16)?;
                self.cen_refs(&p["contradicting"], ARTIFACTS, 16)?;
                if p["supporting"].as_array().is_some_and(Vec::is_empty)
                    && p["contradicting"].as_array().is_some_and(Vec::is_empty)
                {
                    return Err("INVALID".into());
                }
            }
            "deriveEvidenceText" | "saveEvidenceDisclosure" | "withdrawEvidenceDisclosure" => {
                return self.validate_disclosure_command(input);
            }
            "saveCasebook" => {
                allowed(input, &["op", "key", "id", "expected", "payload"])?;
                let p = &input["payload"];
                allowed(p, &["title", "description", "artifacts", "claims"])?;
                text(&p["title"], 1, 160)?;
                text(&p["description"], 0, 10000)?;
                self.cen_refs(&p["artifacts"], ARTIFACTS, 128)?;
                self.cen_refs(&p["claims"], CLAIMS, 128)?;
            }
            _ => return Err("UNSUPPORTED".into()),
        }
        if input.get("id").is_some() {
            parse(&input["id"])?;
            input["expected"].as_u64().ok_or("INVALID")?;
        } else if input.get("expected").is_some() {
            return Err("INVALID".into());
        }
        Ok(())
    }
    fn cen_refs(&self, value: &Value, predicate: Qid, limit: usize) -> Result<Vec<Qid>, String> {
        let list = value.as_array().ok_or("INVALID")?;
        if list.len() > limit {
            return Err("RESOURCE_LIMIT".into());
        }
        let mut seen = std::collections::BTreeSet::new();
        let mut ids = vec![];
        for v in list {
            let id = parse(v)?;
            if !seen.insert(id) {
                return Err("INVALID".into());
            }
            self.cen_row(id, predicate)?;
            ids.push(id);
        }
        Ok(ids)
    }
    pub(super) fn preserve_evidence(&self, input: Value) -> Result<Value, String> {
        if let Some(result) = self.cen_prior(&input)? {
            return Ok(result);
        }
        self.validate_cen_command(&input)?;
        if self.metadata(ARTIFACTS)?.len() >= 256 {
            return Err("RESOURCE_LIMIT".into());
        }
        let bytes = original_bytes(&input["bytes"])?;
        let digest = quanta_core::hash(&bytes);
        let mut p = input["payload"].clone();
        p["lifecycle"] = json!("preserved");
        p["scope"] = json!("private-local-owner");
        p["serverRecordedAtMs"] = json!(now_ms()?);
        p["byteLength"] = json!(bytes.len());
        p["integrity"] = json!({"nativeContent":digest,"sha256":hex(&digest),"blake3":blake3::hash(&bytes).to_hex().to_string(),"factualVerification":false});
        let id = derive("citizen-artifact", &parse(&input["key"])?.0);
        self.cen_commit(
            &input,
            (id, None),
            ARTIFACTS,
            &p,
            Some(bytes),
            Some("preserved"),
        )
    }
    pub(super) fn review_evidence(&self, input: Value) -> Result<Value, String> {
        if let Some(result) = self.cen_prior(&input)? {
            return Ok(result);
        }
        self.validate_cen_command(&input)?;
        let id = parse(&input["id"])?;
        let (_, mut p) = self.cen_row(id, ARTIFACTS)?;
        let next = input["state"].as_str().ok_or("INVALID")?;
        let current = p["lifecycle"].as_str().ok_or("NATIVE_UNAVAILABLE")?;
        let allowed = match current {
            "preserved" => &["needs_context", "under_review", "restricted", "archived"][..],
            "needs_context" => &["under_review", "restricted", "archived"][..],
            "under_review" => &["needs_context", "disputed", "restricted", "archived"][..],
            "disputed" => &["under_review", "restricted", "archived"][..],
            "restricted" | "archived" => &["under_review"][..],
            _ => &[][..],
        };
        if !allowed.contains(&next) {
            return Err("INVALID".into());
        }
        p["lifecycle"] = json!(next);
        p["reviewNote"] = input["note"].clone();
        if let Some(dimensions) = input.get("dimensions") {
            p["verificationDimensions"] = dimensions.clone();
        }
        self.cen_commit(
            &input,
            (id, input["expected"].as_u64()),
            ARTIFACTS,
            &p,
            None,
            Some("review-transition"),
        )
    }
    fn independence_groups(&self, support: &Value) -> Result<usize, String> {
        let rows = self.metadata(ARTIFACTS)?;
        let mut parent: std::collections::BTreeMap<Qid, Qid> =
            rows.iter().map(|(id, _, _)| (*id, *id)).collect();
        fn root(parent: &std::collections::BTreeMap<Qid, Qid>, mut id: Qid) -> Qid {
            for _ in 0..257 {
                let p = parent.get(&id).copied().unwrap_or(id);
                if p == id {
                    return id;
                }
                id = p;
            }
            id
        }
        fn union(parent: &mut std::collections::BTreeMap<Qid, Qid>, a: Qid, b: Qid) {
            let a = root(parent, a);
            let b = root(parent, b);
            if a != b {
                parent.insert(a, b);
            }
        }
        let mut hashes = std::collections::BTreeMap::new();
        let mut origins = std::collections::BTreeMap::new();
        for (id, _, p) in &rows {
            let hash = p["integrity"]["sha256"]
                .as_str()
                .ok_or("NATIVE_UNAVAILABLE")?;
            if let Some(other) = hashes.insert(hash, *id) {
                union(&mut parent, *id, other);
            }
            let group = p["originGroup"]
                .as_str()
                .ok_or("NATIVE_UNAVAILABLE")?
                .trim()
                .to_lowercase();
            if !group.is_empty() {
                if let Some(other) = origins.insert(group.to_owned(), *id) {
                    union(&mut parent, *id, other);
                }
            }
            if !p["dependsOn"].is_null() {
                union(&mut parent, *id, parse(&p["dependsOn"])?);
            }
        }
        let selected = self.cen_refs(support, ARTIFACTS, 16)?;
        let mut valid = std::collections::BTreeSet::new();
        for id in selected {
            let (_, p) = self.cen_row(id, ARTIFACTS)?;
            if p["sourceType"] == "firsthand"
                && p["originGroup"]
                    .as_str()
                    .is_some_and(|s| !s.trim().is_empty())
            {
                valid.insert(root(&parent, id));
            }
        }
        Ok(valid.len())
    }
    pub(super) fn save_claim(&self, input: Value) -> Result<Value, String> {
        if let Some(result) = self.cen_prior(&input)? {
            return Ok(result);
        }
        self.validate_cen_command(&input)?;
        let key = parse(&input["key"])?;
        let id = input
            .get("id")
            .map(parse)
            .transpose()?
            .unwrap_or_else(|| derive("citizen-claim", &key.0));
        if input.get("id").is_some() {
            self.cen_row(id, CLAIMS)?;
        } else if self.metadata(CLAIMS)?.len() >= 256 {
            return Err("RESOURCE_LIMIT".into());
        }
        let mut p = input["payload"].clone();
        let groups = self.independence_groups(&p["supporting"])?;
        if p["status"] == "corroborated"
            && (p["independenceAttested"] != true
                || groups < 2
                || text(&p["rationale"], 10, 4000).is_err())
        {
            return Err("INVALID".into());
        }
        if ["disputed", "refuted"].contains(&p["status"].as_str().ok_or("INVALID")?)
            && p["contradicting"].as_array().is_none_or(Vec::is_empty)
        {
            return Err("INVALID".into());
        }
        p["declaredIndependentGroups"] = json!(groups);
        p["automaticallyVerified"] = json!(false);
        p["assessment"] = json!("local-owner-review");
        self.cen_commit(
            &input,
            (id, input["expected"].as_u64()),
            CLAIMS,
            &p,
            None,
            None,
        )
    }
    pub(super) fn save_casebook(&self, input: Value) -> Result<Value, String> {
        if let Some(result) = self.cen_prior(&input)? {
            return Ok(result);
        }
        self.validate_cen_command(&input)?;
        let key = parse(&input["key"])?;
        let id = input
            .get("id")
            .map(parse)
            .transpose()?
            .unwrap_or_else(|| derive("citizen-casebook", &key.0));
        if input.get("id").is_some() {
            self.cen_row(id, CASEBOOKS)?;
        } else if self.metadata(CASEBOOKS)?.len() >= 64 {
            return Err("RESOURCE_LIMIT".into());
        }
        self.cen_commit(
            &input,
            (id, input["expected"].as_u64()),
            CASEBOOKS,
            &input["payload"],
            None,
            None,
        )
    }
    pub(super) fn evidence_network(&self) -> Result<Value, String> {
        let rows = |predicate| -> Result<Vec<Value>, String> {
            let mut r = self.metadata(predicate)?;
            r.sort_by_key(|r| std::cmp::Reverse(r.1));
            Ok(r.into_iter().map(|(id,revision,payload)|json!({"id":id.to_canonical_string(),"revision":revision,"payload":payload})).collect())
        };
        Ok(
            json!({"artifacts":rows(ARTIFACTS)?,"claims":rows(CLAIMS)?,"casebooks":rows(CASEBOOKS)?,"disclosures":self.disclosure_summaries()?,"scope":"private-local-owner","publicPublicationEnabled":false,"automaticVerificationEnabled":false}),
        )
    }
    pub(super) fn artifact_original(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "id"])?;
        let id = parse(&input["id"])?;
        let (_, p) = self.cen_row(id, ARTIFACTS)?;
        let hash = p["integrity"]["nativeContent"]
            .as_array()
            .ok_or("NATIVE_UNAVAILABLE")?;
        let mut digest = [0u8; 32];
        if hash.len() != 32 {
            return Err("NATIVE_UNAVAILABLE".into());
        }
        for (i, v) in hash.iter().enumerate() {
            digest[i] = v
                .as_u64()
                .and_then(|n| u8::try_from(n).ok())
                .ok_or("NATIVE_UNAVAILABLE")?;
        }
        let bytes = self
            .db()?
            .read_content_current(self.domain, self.owner, digest)
            .map_err(err)?;
        if hex(&quanta_core::hash(&bytes)) != p["integrity"]["sha256"]
            || blake3::hash(&bytes).to_hex().as_str() != p["integrity"]["blake3"]
        {
            return Err("NATIVE_UNAVAILABLE".into());
        }
        Ok(
            json!({"id":id.to_canonical_string(),"bytes":bytes,"fileName":p["fileName"],"mediaType":p["mediaType"],"sha256":p["integrity"]["sha256"],"blake3":p["integrity"]["blake3"],"factualVerification":false}),
        )
    }
    pub(super) fn evidence_custody(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "id"])?;
        let id = parse(&input["id"])?;
        self.cen_row(id, ARTIFACTS)?;
        let mut rows = self
            .db()?
            .query_current(
                self.domain,
                self.owner,
                &Query {
                    predicate: Some(CUSTODY),
                    subject: Some(id),
                    ..Query::default()
                },
            )
            .map_err(err)?;
        rows.sort_by_key(|r| std::cmp::Reverse(r.sequence));
        let truncated = rows.len() > 100;
        let items = rows
            .into_iter()
            .take(100)
            .map(|r| {
                let t = match r.statement.ok_or("NATIVE_UNAVAILABLE")?.value {
                    Native::Text(t) => t,
                    Native::Map(mut m) => match m.remove("metadata") {
                        Some(Native::Text(t)) => t,
                        _ => return Err("NATIVE_UNAVAILABLE"),
                    },
                    _ => return Err("NATIVE_UNAVAILABLE"),
                };
                let payload: Value = serde_json::from_str(&t).map_err(|_| "NATIVE_UNAVAILABLE")?;
                Ok(json!({"revision":r.sequence,"payload":payload}))
            })
            .collect::<Result<Vec<_>, &str>>()?;
        Ok(json!({"items":items,"truncated":truncated,"signedByExternalWitness":false}))
    }
}
