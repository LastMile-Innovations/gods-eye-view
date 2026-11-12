//! Durable private command recovery and desktop metadata on the canonical native store.
use super::*;
const OPERATIONS: Qid = Qid(*b"NEIGHBOR_OPS__01");
const DESKS: Qid = Qid(*b"NEIGHBOR_DESK_01");
const APPS: &[&str] = &[
    "records",
    "board",
    "documents",
    "marketplace",
    "projects",
    "social",
    "agent",
    "recovery",
    "desks",
    "history",
    "evidence",
];
pub(super) fn statement(id: Qid, predicate: Qid, value: &Value) -> Statement {
    let mut fields =
        std::collections::BTreeMap::from([("metadata".into(), Native::Text(value.to_string()))]);
    if let Some(kind) = value.get("kind").and_then(Value::as_str) {
        fields.insert("kind".into(), Native::Text(kind.to_owned()));
    }
    if let Some(title) = value.get("title").and_then(Value::as_str) {
        fields.insert("title".into(), Native::Text(title.to_owned()));
    }
    if let Some(status) = value.get("status").and_then(Value::as_str) {
        fields.insert("status".into(), Native::Text(status.to_owned()));
    }
    if let Some(coords) = value.get("coordinates") {
        if let Some(geo) = super::domain::native_geo_value(coords) {
            fields.insert("geo".into(), geo);
        }
    }
    Statement {
        id,
        subject: id,
        predicate,
        roles: vec![],
        value: Native::Map(fields),
        source: None,
        epistemic: Epistemic::Authoritative,
        valid_from: None,
        valid_until: None,
    }
}
fn decode(row: quanta_core::Revision, predicate: Qid) -> Result<(u64, Value), String> {
    let s = row.statement.ok_or("NOT_AVAILABLE")?;
    if s.predicate != predicate {
        return Err("NOT_AVAILABLE".into());
    }
    let text = match s.value {
        Native::Text(text) => text,
        Native::Map(mut fields) => match fields.remove("metadata") {
            Some(Native::Text(text)) => text,
            _ => return Err("NATIVE_UNAVAILABLE".into()),
        },
        _ => return Err("NATIVE_UNAVAILABLE".into()),
    };
    Ok((
        row.sequence,
        serde_json::from_str(&text).map_err(|_| "NATIVE_UNAVAILABLE")?,
    ))
}
fn original_hash(value: &Value) -> Result<Option<quanta_core::Hash>, String> {
    let Some(v) = value.get("originalContent") else {
        return Ok(None);
    };
    let list = v.as_array().ok_or("NATIVE_UNAVAILABLE")?;
    if list.len() != 32 {
        return Err("NATIVE_UNAVAILABLE".into());
    }
    let mut hash = [0u8; 32];
    for (i, v) in list.iter().enumerate() {
        hash[i] = v
            .as_u64()
            .and_then(|n| u8::try_from(n).ok())
            .ok_or("NATIVE_UNAVAILABLE")?;
    }
    Ok(Some(hash))
}
fn journal_statement(id: Qid, value: &Value) -> Result<Statement, String> {
    let mut row = statement(id, OPERATIONS, value);
    let mut fields =
        std::collections::BTreeMap::from([("metadata".into(), Native::Text(value.to_string()))]);
    if let Some(hash) = original_hash(value)? {
        fields.insert("original".into(), Native::Content(hash));
    }
    row.value = Native::Map(fields);
    Ok(row)
}
pub(super) fn fingerprint(value: &Value) -> String {
    Sha256::digest(value.to_string().as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn summary(revision: u64, value: &Value) -> Value {
    let cmd = &value["command"];
    let fallback = match cmd["op"].as_str() {
        Some("reviewEvidence") => "Evidence lifecycle review",
        Some("executeAgentPlan") => "Execute approved AI Agent plan",
        Some("seedStarterCatalog") => "Load local starter catalog",
        _ => "Native workspace action",
    };
    let title: String = cmd["payload"]["title"]
        .as_str()
        .or(cmd["payload"]["name"].as_str())
        .or(cmd["payload"]["text"].as_str())
        .or(cmd["payload"]["prompt"].as_str())
        .unwrap_or(fallback)
        .chars()
        .take(160)
        .collect();
    json!({"key":cmd["key"],"state":value["state"],"kind":cmd["op"],"executionProfile":if cmd["op"] == "qhExecute" && cmd["operation"] == "execute" && cmd["execution"]["strategy"] == "workflow" && cmd["execution"]["interaction"] == "sync" && cmd["workflowId"].is_string() {json!("native_read_workflow")} else {Value::Null},"title":title,"revision":revision,"result":value["result"],"error":value["error"]})
}
fn validate_layout(v: &Value) -> Result<(), String> {
    allowed(
        v,
        &[
            "version",
            "focused",
            "windows",
            "presentation",
            "splitRatio",
        ],
    )?;
    if v["version"] != 1 && v["version"] != 2 {
        return Err("INVALID".into());
    }
    if v["version"] == 2
        && (!["desktop", "focus", "split"].contains(&v["presentation"].as_str().ok_or("INVALID")?)
            || v["splitRatio"]
                .as_f64()
                .is_none_or(|r| !(0.25..=0.6).contains(&r)))
    {
        return Err("INVALID".into());
    }
    if let Some(f) = v.get("focused") {
        if !f.is_null() && !APPS.contains(&f.as_str().ok_or("INVALID")?) {
            return Err("INVALID".into());
        }
    }
    let windows = v["windows"].as_array().ok_or("INVALID")?;
    if windows.len() > APPS.len() {
        return Err("RESOURCE_LIMIT".into());
    }
    let mut seen = std::collections::BTreeSet::new();
    for w in windows {
        allowed(
            w,
            &[
                "appId",
                "open",
                "minimized",
                "mode",
                "contextMode",
                "linkGroup",
                "rect",
            ],
        )?;
        let app = w["appId"].as_str().ok_or("INVALID")?;
        if !APPS.contains(&app)
            || !seen.insert(app)
            || w["open"].as_bool().is_none()
            || w["minimized"].as_bool().is_none()
            || !["normal", "maximized", "left", "right"]
                .contains(&w["mode"].as_str().ok_or("INVALID")?)
        {
            return Err("INVALID".into());
        }
        if let Some(cm) = w.get("contextMode") {
            if !cm.is_null()
                && !["independent", "follow-world", "linked"]
                    .contains(&cm.as_str().ok_or("INVALID")?)
            {
                return Err("INVALID".into());
            }
        }
        if let Some(lg) = w.get("linkGroup") {
            if !lg.is_null()
                && !["amber", "cyan", "emerald", "violet"].contains(&lg.as_str().ok_or("INVALID")?)
            {
                return Err("INVALID".into());
            }
        }
        allowed(&w["rect"], &["x", "y", "width", "height"])?;
        for field in ["x", "y", "width", "height"] {
            let n = w["rect"][field].as_f64().ok_or("INVALID")?;
            if !n.is_finite()
                || !(if field == "x" || field == "y" {
                    0.0..=1_000_000.0
                } else {
                    1.0..=1_000_000.0
                })
                .contains(&n)
            {
                return Err("INVALID".into());
            }
        }
    }
    Ok(())
}
impl Workspace {
    pub(super) fn metadata(&self, predicate: Qid) -> Result<Vec<(Qid, u64, Value)>, String> {
        self.db()?
            .query_current(
                self.domain,
                self.owner,
                &Query {
                    predicate: Some(predicate),
                    ..Query::default()
                },
            )
            .map_err(err)?
            .into_iter()
            .map(|row| {
                let id = row.statement.as_ref().ok_or("NOT_AVAILABLE")?.id;
                let (revision, value) = decode(row, predicate)?;
                Ok((id, revision, value))
            })
            .collect()
    }
    fn operation_value(&self, key: Qid) -> Result<(u64, Value), String> {
        let id = derive("operation", &key.0);
        decode(
            self.db()?
                .revision_current(self.domain, self.owner, id, None)
                .map_err(err)?
                .ok_or("NOT_AVAILABLE")?,
            OPERATIONS,
        )
    }
    pub(super) fn operation(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "key", "request"])?;
        let (revision, value) = self.operation_value(parse(&input["key"])?)?;
        if let Some(request) = input.get("request") {
            if fingerprint(request) != value["requestHash"].as_str().ok_or("NATIVE_UNAVAILABLE")? {
                return Err("INVALID".into());
            }
        }
        Ok(summary(revision, &value))
    }
    pub(super) fn operations(&self) -> Result<Value, String> {
        let mut rows = self.metadata(OPERATIONS)?;
        rows.sort_by_key(|r| std::cmp::Reverse(r.1));
        Ok(
            json!({"items":rows.iter().map(|(_,r,v)|summary(*r,v)).collect::<Vec<_>>(),"scope":"private-local-owner","limit":2000,"changeInbox":self.change_inbox()?}),
        )
    }
    fn validate_command(&self, command: &Value) -> Result<(), String> {
        parse(&command["key"])?;
        match command["op"].as_str().ok_or("INVALID")? {
            "write" => {
                allowed(command, &["op", "key", "id", "expected", "payload"])?;
                if command.get("id").is_some() {
                    parse(&command["id"])?;
                    command["expected"].as_u64().ok_or("INVALID")?;
                } else if command.get("expected").is_some() {
                    return Err("INVALID".into());
                }
                self.validate_payload(&command["payload"], false)
            }
            "import" => {
                allowed(command, &["op", "key", "payload", "original", "selector"])?;
                self.validate_payload(&command["payload"], true)?;
                if command["original"].as_str().ok_or("INVALID")?.len() > MAX_ORIGINAL {
                    return Err("RESOURCE_LIMIT".into());
                }
                if let Some(s) = command.get("selector") {
                    if s.as_str().is_none_or(|x| x.len() > 200) {
                        return Err("INVALID".into());
                    }
                }
                Ok(())
            }
            "preserveEvidence"
            | "reviewEvidence"
            | "saveEvidenceClaim"
            | "saveCasebook"
            | "deriveEvidenceText"
            | "saveEvidenceDisclosure"
            | "withdrawEvidenceDisclosure" => self.validate_cen_command(command),
            "saveMarketOffer"
            | "saveProposal"
            | "saveCommitment"
            | "verifyCommitmentOutcome"
            | "saveProject"
            | "saveSocialPost"
            | "compileAgentPlan"
            | "executeAgentPlan"
            | "seedStarterCatalog" => self.validate_domain_command(command),
            "qhCreateMandate"
            | "qhRevokeMandate"
            | "qhCompileFrame"
            | "qhSaveMemory"
            | "qhSaveWorkflow"
            | "qhValidateWorkflow"
            | "qhExecute"
            | "qhReconcileRun"
            | "qhCreateMission"
            | "qhMissionAction"
            | "qhRunEval"
            | "qhOpenAiResponses"
            | "qhOpenAiCancelResponse" => Ok(()),
            "saveDesk" => self.validate_desk(command),
            "deleteDesk" => {
                allowed(command, &["op", "key", "id", "expected"])?;
                parse(&command["id"])?;
                command["expected"].as_u64().ok_or("INVALID")?;
                Ok(())
            }
            _ => Err("UNSUPPORTED".into()),
        }
    }
    pub(super) fn prepare(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "request", "command"])?;
        let original_request = &input["request"];
        let mut normalized_request = original_request.clone();
        let draft_ref = normalized_request
            .as_object_mut()
            .ok_or("INVALID")?
            .remove("draft");
        let request = &normalized_request;
        let key = parse(&request["key"])?;
        match self.operation_value(key) {
            Ok((revision, value)) => {
                if value["requestHash"] != fingerprint(original_request) {
                    return Err("INVALID".into());
                }
                return Ok(summary(revision, &value));
            }
            Err(code) if code == "NOT_AVAILABLE" => {}
            Err(code) => return Err(code),
        }
        let cmd = &input["command"];
        if parse(&cmd["key"])? != key {
            return Err("INVALID".into());
        }
        match request["op"].as_str().ok_or("INVALID")? {
            "import" => {
                let mut normalized = request.clone();
                if normalized
                    .as_object_mut()
                    .ok_or("INVALID")?
                    .remove("permissionConfirmed")
                    != Some(json!(true))
                    || normalized != *cmd
                    || cmd["payload"]["kind"] != "document"
                {
                    return Err("INVALID".into());
                }
            }
            "importReference" => {
                allowed(request, &["op", "key", "eventId"])?;
                if cmd["op"] != "import"
                    || cmd["payload"]["kind"] != "reference"
                    || request["eventId"] != cmd["payload"]["sourceRecord"]
                {
                    return Err("INVALID".into());
                }
            }
            _ => {
                if request != cmd {
                    return Err("INVALID".into());
                }
            }
        }
        self.validate_command(cmd)?;
        if self.metadata(OPERATIONS)?.len() >= 2000 {
            return Err("RESOURCE_LIMIT".into());
        }
        let mut command = cmd.clone();
        let mut content = vec![];
        let mut value = json!({"requestHash":fingerprint(original_request),"state":"pending","result":null,"error":null});
        if command["op"] == "import" {
            let original = command
                .as_object_mut()
                .ok_or("INVALID")?
                .remove("original")
                .and_then(|v| v.as_str().map(str::to_owned))
                .ok_or("INVALID")?
                .into_bytes();
            value["originalContent"] = json!(quanta_core::hash(&original));
            content.push(original);
        }
        if command["op"] == "preserveEvidence" {
            let bytes = super::citizen::original_bytes(&command["bytes"])?;
            command.as_object_mut().ok_or("INVALID")?.remove("bytes");
            value["originalContent"] = json!(quanta_core::hash(&bytes));
            content.push(bytes);
        }
        value["command"] = command;
        if let Some(reference) = &draft_ref {
            value["draftRef"] = reference.clone();
        }
        let mut draft_mutations = vec![];
        let mut draft_heads = vec![];
        if let Some(reference) = &draft_ref {
            let (h, m) = self.draft_binding(reference, key)?;
            draft_heads.push(h);
            draft_mutations.push(m);
        }
        let id = derive("operation", &key.0);
        let mut db = self.db_mut()?;
        let result = receipt(
            db.commit(Batch {
                domain: self.domain,
                principal: self.owner,
                key: derive("prepare-command", &key.0),
                heads: {
                    draft_heads.push(Head {
                        statement: id,
                        expected: None,
                    });
                    draft_heads
                },
                mutations: {
                    draft_mutations.push(Mutation::Put(journal_statement(id, &value)?));
                    draft_mutations
                },
                content,
            }),
            id,
        )?;
        Ok(summary(
            result["sequence"].as_u64().ok_or("NATIVE_UNAVAILABLE")?,
            &value,
        ))
    }
    pub(super) fn resume(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "key"])?;
        let key = parse(&input["key"])?;
        let (revision, mut value) = self.operation_value(key)?;
        if value["state"] == "committed" {
            return Ok(value["result"].clone());
        }
        if value["state"] == "rejected" {
            return Err(value["error"].as_str().ok_or("NATIVE_UNAVAILABLE")?.into());
        }
        if value["state"] != "pending" {
            return Err("NATIVE_UNAVAILABLE".into());
        }
        let mut cmd = value["command"].clone();
        if let Some(hash) = original_hash(&value)? {
            let bytes = self
                .db()?
                .read_content_current(self.domain, self.owner, hash)
                .map_err(err)?;
            if cmd["op"] == "preserveEvidence" {
                cmd["bytes"] = json!(bytes);
            } else {
                cmd["original"] =
                    json!(String::from_utf8(bytes).map_err(|_| "NATIVE_UNAVAILABLE")?);
            }
        }
        let result = match cmd["op"].as_str() {
            Some("write") => self.write(cmd),
            Some("import") => self.import(cmd),
            Some("saveMarketOffer") => self.save_market_offer(cmd),
            Some("saveProposal") => self.save_proposal(cmd),
            Some("saveCommitment") => self.save_commitment(cmd),
            Some("verifyCommitmentOutcome") => self.verify_commitment_outcome(cmd),
            Some("saveProject") => self.save_project(cmd),
            Some("saveSocialPost") => self.save_social_post(cmd),
            Some("compileAgentPlan") => self.compile_agent_plan(cmd),
            Some("executeAgentPlan") => self.execute_agent_plan(cmd),
            Some("seedStarterCatalog") => self.seed_starter_catalog(cmd),
            Some("qhCreateMandate") => self.qh_create_mandate(cmd),
            Some("qhRevokeMandate") => self.qh_revoke_mandate(cmd),
            Some("qhCompileFrame") => self.qh_compile_frame(cmd),
            Some("qhSaveMemory") => self.qh_save_memory(cmd),
            Some("qhSaveWorkflow") => self.qh_save_workflow(cmd),
            Some("qhValidateWorkflow") => self.qh_validate_workflow(cmd),
            Some("qhExecute") => self.qh_execute(cmd),
            Some("qhReconcileRun") => self.qh_reconcile_run(cmd),
            Some("qhCreateMission") => self.qh_create_mission(cmd),
            Some("qhMissionAction") => self.qh_mission_action(cmd),
            Some("qhRunEval") => self.qh_run_eval(cmd),
            Some("qhOpenAiResponses") => self.qh_openai_responses(cmd),
            Some("qhOpenAiCancelResponse") => self.qh_openai_cancel_response(cmd),
            Some("deriveEvidenceText") => self.derive_evidence_text(cmd),
            Some("saveEvidenceDisclosure") => self.save_disclosure(cmd),
            Some("withdrawEvidenceDisclosure") => self.withdraw_disclosure(cmd),
            Some("preserveEvidence") => self.preserve_evidence(cmd),
            Some("reviewEvidence") => self.review_evidence(cmd),
            Some("saveEvidenceClaim") => self.save_claim(cmd),
            Some("saveCasebook") => self.save_casebook(cmd),
            Some("saveDesk") => self.save_desk(cmd),
            Some("deleteDesk") => self.delete_desk(cmd),
            _ => Err("UNSUPPORTED".into()),
        };
        match &result {
            Ok(saved) => {
                value["state"] = json!("committed");
                value["result"] = saved.clone();
            }
            Err(code) if ["UNKNOWN_OUTCOME", "NATIVE_UNAVAILABLE"].contains(&code.as_str()) => {
                return result
            }
            Err(code) => {
                value["state"] = json!("rejected");
                value["error"] = json!(code);
            }
        }
        let id = derive("operation", &key.0);
        let mut heads = vec![Head {
            statement: id,
            expected: Some(revision),
        }];
        let mut mutations = vec![Mutation::Put(journal_statement(id, &value)?)];
        if let Some(reference) = value.get("draftRef") {
            let (h, m) = self.draft_completion(reference, key, result.is_ok())?;
            heads.push(h);
            mutations.push(m);
        }
        let out = self.db_mut()?.commit(Batch {
            domain: self.domain,
            principal: self.owner,
            key: derive("finish-command", &key.0),
            heads,
            mutations,
            content: vec![],
        });
        receipt(out, id)?;
        result
    }
    fn validate_desk(&self, input: &Value) -> Result<(), String> {
        allowed(input, &["op", "key", "id", "expected", "payload"])?;
        parse(&input["key"])?;
        allowed(&input["payload"], &["name", "layout"])?;
        let name = input["payload"]["name"].as_str().ok_or("INVALID")?;
        if name.trim().is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control)
        {
            return Err("INVALID".into());
        }
        validate_layout(&input["payload"]["layout"])?;
        if input.get("id").is_some() {
            parse(&input["id"])?;
            input["expected"].as_u64().ok_or("INVALID")?;
        } else if input.get("expected").is_some() {
            return Err("INVALID".into());
        }
        Ok(())
    }
    pub(super) fn save_desk(&self, input: Value) -> Result<Value, String> {
        self.validate_desk(&input)?;
        let key = parse(&input["key"])?;
        let id = input
            .get("id")
            .map(parse)
            .transpose()?
            .unwrap_or_else(|| derive("desk", &key.0));
        let expected = input.get("expected").and_then(Value::as_u64);
        let resolved = self
            .db()?
            .resolve(self.domain, self.owner, key)
            .map_err(err)?
            .is_some();
        if !resolved {
            if expected.is_some() {
                decode(
                    self.db()?
                        .revision_current(self.domain, self.owner, id, None)
                        .map_err(err)?
                        .ok_or("NOT_AVAILABLE")?,
                    DESKS,
                )?;
            } else if self.metadata(DESKS)?.len() >= 32 {
                return Err("RESOURCE_LIMIT".into());
            }
        }
        receipt(
            self.db_mut()?.commit(Batch {
                domain: self.domain,
                principal: self.owner,
                key,
                heads: vec![Head {
                    statement: id,
                    expected,
                }],
                mutations: vec![Mutation::Put(statement(id, DESKS, &input["payload"]))],
                content: vec![],
            }),
            id,
        )
    }
    pub(super) fn delete_desk(&self, input: Value) -> Result<Value, String> {
        self.validate_command(&input)?;
        let key = parse(&input["key"])?;
        let id = parse(&input["id"])?;
        let expected = input["expected"].as_u64().ok_or("INVALID")?;
        if self
            .db()?
            .resolve(self.domain, self.owner, key)
            .map_err(err)?
            .is_none()
        {
            decode(
                self.db()?
                    .revision_current(self.domain, self.owner, id, None)
                    .map_err(err)?
                    .ok_or("NOT_AVAILABLE")?,
                DESKS,
            )?;
        }
        receipt(
            self.db_mut()?.commit(Batch {
                domain: self.domain,
                principal: self.owner,
                key,
                heads: vec![Head {
                    statement: id,
                    expected: Some(expected),
                }],
                mutations: vec![Mutation::Withdraw(id)],
                content: vec![],
            }),
            id,
        )
    }
    pub(super) fn desks(&self) -> Result<Value, String> {
        Ok(
            json!({"items":self.metadata(DESKS)?.into_iter().map(|(id,revision,payload)|json!({"id":id.to_canonical_string(),"revision":revision,"payload":payload})).collect::<Vec<_>>()}),
        )
    }
    pub(super) fn history(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "id", "before", "limit"])?;
        let id = parse(&input["id"])?;
        let db = self.db()?;
        let current = db.domain_sequence(self.domain, self.owner).map_err(err)?;
        let mut before = match input.get("before") {
            Some(n) => n.as_u64().ok_or("INVALID")?,
            None => current,
        };
        let limit = match input.get("limit") {
            Some(n) => n.as_u64().ok_or("INVALID")?,
            None => 20,
        };
        if before > current || limit == 0 || limit > 50 {
            return Err("INVALID".into());
        }
        let row = db
            .revision_current(self.domain, self.owner, id, None)
            .map_err(err)?
            .ok_or("NOT_AVAILABLE")?;
        let predicate = row.statement.as_ref().ok_or("UNSUPPORTED")?.predicate;
        if ![
            RECORDS,
            super::domain::MARKET_OFFERS,
            super::domain::PROPOSALS,
            super::domain::PROJECTS,
            super::domain::SOCIAL_POSTS,
            super::domain::AGENT_PLANS,
        ]
        .contains(&predicate)
        {
            return Err("UNSUPPORTED".into());
        }
        let mut items = vec![];
        while before > 0 && items.len() < limit as usize {
            let Some(row) = db
                .revision_current(self.domain, self.owner, id, Some(before))
                .map_err(err)?
            else {
                break;
            };
            let (revision, payload) = decode(row, predicate)?;
            items.push(json!({"revision":revision,"payload":payload,"epistemic":"Authored"}));
            before = revision.saturating_sub(1);
        }
        let truncated = before > 0
            && db
                .revision_current(self.domain, self.owner, id, Some(before))
                .map_err(err)?
                .is_some();
        Ok(
            json!({"id":id.to_canonical_string(),"items":items,"nextBefore":if truncated{Some(before)}else{None},"truncated":truncated,"validTimeSupported":false,"scope":"authorized-as-known-native-revisions"}),
        )
    }
}
