//! Private textual drafts. These are never domain effects, consents, or executable commands.
use super::lifecycle::statement;
use super::*;
const DRAFTS: Qid = Qid(*b"NEIGHBOR_DRF__01");
const APPS: &[&str] = &[
    "records",
    "board",
    "documents",
    "projects",
    "marketplace",
    "social",
    "agent",
    "evidence",
    "history",
    "desks",
    "recovery",
];
const FIELDS: &[&str] = &[
    "longitude",
    "latitude",
    "next-lifecycle-state",
    "dimension-integrity",
    "dimension-integrity-notes",
    "dimension-origin",
    "dimension-origin-notes",
    "dimension-time",
    "dimension-time-notes",
    "dimension-location",
    "dimension-location-notes",
    "dimension-content",
    "dimension-content-notes",
    "dimension-corroboration",
    "dimension-corroboration-notes",
    "title",
    "kind",
    "description",
    "project-title",
    "total-budget-usd",
    "initial-stage",
    "place-on-globe",
    "project-description",
    "milestones-one-per-line",
    "bill-of-materials-format-item-category-usd-amount",
    "natural-language-intent-prompt",
    "target-budget-envelope-usd",
    "anchor-place-on-globe",
    "offer-title",
    "category",
    "provider-guild-name",
    "credentials-skills",
    "exact-price-usd",
    "rate-basis",
    "neighborhood-place",
    "detailed-scope-terms",
    "verification-evidence-record",
    "outcome-note",
    "link-to-project",
    "deliverable-scope",
    "agreed-total-usd",
    "channel",
    "author",
    "attach-live-object-card",
    "message-body",
    "desk-name",
    "evidence-title",
    "origin-group",
    "asserted-time",
    "evidence-notes",
    "evidence-family",
    "source-type",
    "derived-from",
    "claim-text",
    "claim-rationale",
    "casebook-title",
    "casebook-description",
    "redaction-ranges",
    "derivative-title",
    "redaction-reason",
    "disclosure-title",
    "withdrawal-note",
    "review-note",
    "details",
];
impl Workspace {
    pub(super) fn draft_value(&self, id: Qid) -> Result<(u64, Value), String> {
        self.metadata(DRAFTS)?
            .into_iter()
            .find(|r| r.0 == id)
            .map(|(_, r, v)| (r, v))
            .ok_or("NOT_AVAILABLE".into())
    }
    pub(super) fn draft_read(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "id"])?;
        let id = parse(&input["id"])?;
        let (revision, value) = self.draft_value(id)?;
        Ok(
            json!({"id":id.to_canonical_string(),"revision":revision,"payload":value["payload"],"state":value["state"],"submissionKey":value["submissionKey"]}),
        )
    }
    pub(super) fn drafts(&self) -> Result<Value, String> {
        let items:Vec<_>=self.metadata(DRAFTS)?.into_iter().filter(|(_,_,v)|v["state"]=="active" || v["state"]=="submitting").map(|(id,r,v)|json!({"id":id.to_canonical_string(),"revision":r,"appId":v["payload"]["appId"],"formId":v["payload"]["formId"],"state":v["state"]})).collect();
        Ok(json!({"items":items}))
    }
    pub(super) fn save_draft(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "key", "expected", "payload"])?;
        let key = parse(&input["key"])?;
        let p = &input["payload"];
        allowed(p, &["appId", "formId", "fields", "references"])?;
        if let Some(refs) = p.get("references") {
            let rows = refs.as_array().ok_or("INVALID")?;
            if rows.len() > 16 {
                return Err("RESOURCE_LIMIT".into());
            }
            for r in rows {
                allowed(r, &["id", "revision"])?;
                self.existing(parse(&r["id"])?)?;
                r["revision"].as_u64().ok_or("INVALID")?;
            }
        }
        let app = p["appId"].as_str().ok_or("INVALID")?;
        let form = p["formId"].as_str().ok_or("INVALID")?;
        if !APPS.contains(&app)
            || !form.starts_with(&format!("{app}:"))
            || form.len() > 128
            || !form
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b":-_".contains(&c))
        {
            return Err("INVALID".into());
        }
        let fields = p["fields"].as_object().ok_or("INVALID")?;
        if fields.len() > 64 || p.to_string().len() > 65536 {
            return Err("RESOURCE_LIMIT".into());
        }
        for (k, v) in fields {
            if !FIELDS.contains(&k.as_str()) || v.as_str().is_none() {
                return Err("INVALID".into());
            }
        }
        let id = derive("private-draft", format!("{app}/{form}").as_bytes());
        let mut expected = input
            .get("expected")
            .filter(|v| !v.is_null())
            .map(|v| v.as_u64().ok_or("INVALID"))
            .transpose()?;
        let prior = self
            .db()?
            .resolve(self.domain, self.owner, key)
            .map_err(err)?;
        if let Some(r) = prior {
            let row = self
                .db()?
                .revision_current(self.domain, self.owner, id, Some(r.sequence))
                .map_err(err)?
                .ok_or("INVALID")?;
            let stmt = row.statement.ok_or("INVALID")?;
            let Native::Map(fields) = stmt.value else {
                return Err("INVALID".into());
            };
            let Some(Native::Text(metadata)) = fields.get("metadata") else {
                return Err("INVALID".into());
            };
            let value: Value = serde_json::from_str(metadata).map_err(|_| "INVALID")?;
            if value["requestHash"] != super::lifecycle::fingerprint(&input) {
                return Err("INVALID".into());
            }
            return Ok(
                json!({"id":id.to_canonical_string(),"revision":r.sequence,"state":"active"}),
            );
        }
        match self.draft_value(id) {
            Ok((_, v)) if v["state"] == "submitting" => return Err("CONFLICT".into()),
            Ok((r, v))
                if expected.is_none()
                    && (v["state"] == "submitted" || v["state"] == "discarded") =>
            {
                expected = Some(r)
            }
            Err(ref e) if e != "NOT_AVAILABLE" => return Err(e.clone()),
            _ => {}
        }
        if expected.is_none()
            && self
                .metadata(DRAFTS)?
                .iter()
                .filter(|(_, _, v)| v["state"] == "active")
                .count()
                >= 32
        {
            return Err("RESOURCE_LIMIT".into());
        }
        let value = json!({"payload":p,"state":"active","submissionKey":null,"requestHash":super::lifecycle::fingerprint(&input)});
        let saved = receipt(
            self.db_mut()?.commit(Batch {
                domain: self.domain,
                principal: self.owner,
                key,
                heads: vec![Head {
                    statement: id,
                    expected,
                }],
                mutations: vec![Mutation::Put(statement(id, DRAFTS, &value))],
                content: vec![],
            }),
            id,
        )?;
        Ok(json!({"id":id.to_canonical_string(),"revision":saved["sequence"],"state":"active"}))
    }
    pub(super) fn discard_draft(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "key", "id", "expected"])?;
        let id = parse(&input["id"])?;
        let key = parse(&input["key"])?;
        let expected = input["expected"].as_u64().ok_or("INVALID")?;
        let (_, mut value) = self.draft_value(id)?;
        if value["state"] == "submitting" {
            return Err("CONFLICT".into());
        }
        value["state"] = json!("discarded");
        value["payload"]["fields"] = json!({});
        let saved = receipt(
            self.db_mut()?.commit(Batch {
                domain: self.domain,
                principal: self.owner,
                key,
                heads: vec![Head {
                    statement: id,
                    expected: Some(expected),
                }],
                mutations: vec![Mutation::Put(statement(id, DRAFTS, &value))],
                content: vec![],
            }),
            id,
        )?;
        Ok(json!({"id":id.to_canonical_string(),"revision":saved["sequence"],"state":"discarded"}))
    }
    pub(super) fn draft_binding(
        &self,
        reference: &Value,
        key: Qid,
    ) -> Result<(Head, Mutation), String> {
        allowed(reference, &["id", "revision"])?;
        let id = parse(&reference["id"])?;
        let expected = reference["revision"].as_u64().ok_or("INVALID")?;
        let (r, mut v) = self.draft_value(id)?;
        if r != expected || v["state"] != "active" {
            return Err("CONFLICT".into());
        }
        v["state"] = json!("submitting");
        v["submissionKey"] = json!(key.to_canonical_string());
        Ok((
            Head {
                statement: id,
                expected: Some(r),
            },
            Mutation::Put(statement(id, DRAFTS, &v)),
        ))
    }
    pub(super) fn draft_completion(
        &self,
        reference: &Value,
        key: Qid,
        success: bool,
    ) -> Result<(Head, Mutation), String> {
        let id = parse(&reference["id"])?;
        let (r, mut v) = self.draft_value(id)?;
        if v["submissionKey"] != key.to_canonical_string() {
            return Err("CONFLICT".into());
        }
        v["state"] = json!(if success { "submitted" } else { "active" });
        if success {
            v["payload"]["fields"] = json!({});
        } else {
            v["submissionKey"] = Value::Null;
        }
        Ok((
            Head {
                statement: id,
                expected: Some(r),
            },
            Mutation::Put(statement(id, DRAFTS, &v)),
        ))
    }
}
