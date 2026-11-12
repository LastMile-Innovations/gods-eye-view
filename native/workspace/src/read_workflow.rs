//! Executed, definition-pinned read workflows. No model, provider, or write stage is admitted.
use super::citizen::now_ms;
use super::domain::{DOMAIN_ADMIT, ROLE_LINK};
use super::lifecycle::{fingerprint, statement};
use super::qharness::{qh_statement, QH_EVALS, QH_FLOWS};
use super::*;
use std::collections::BTreeSet;
use std::time::Instant;

pub(super) fn definition_digest(p: &Value) -> String {
    fingerprint(
        &json!({"workflowId":p["workflowId"],"title":p["title"],"origin":p["origin"],"stages":p["stages"]}),
    )
}
pub(super) fn validate_stages(p: &Value) -> Result<(), String> {
    let stages = p["stages"].as_array().ok_or("INVALID")?;
    if stages.is_empty() || stages.len() > 8 {
        return Err("RESOURCE_LIMIT".into());
    }
    let mut ids = BTreeSet::new();
    for stage in stages {
        allowed(stage, &["id", "action", "input"])?;
        let id = stage["id"].as_str().ok_or("INVALID")?;
        if id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            || !ids.insert(id)
        {
            return Err("INVALID".into());
        }
        let input = stage.get("input").cloned().unwrap_or_else(|| json!({}));
        match stage["action"].as_str().ok_or("INVALID")? {
            "quanta.query" | "market.searchOffers" => {
                allowed(&input, &[])?;
            }
            "world.timeQuery" => {
                allowed(&input, &["asKnownAt", "mode"])?;
                if input.get("asKnownAt").is_some_and(|v| !v.is_u64()) {
                    return Err("INVALID".into());
                }
                if let Some(mode) = input.get("mode") {
                    if ![
                        "observedHistory",
                        "reconstructedHistory",
                        "asKnownHistory",
                        "liveObserved",
                        "forecastModel",
                        "scenarioFork",
                    ]
                    .contains(&mode.as_str().ok_or("INVALID")?)
                    {
                        return Err("INVALID".into());
                    }
                }
            }
            _ => return Err("UNSUPPORTED".into()),
        }
    }
    Ok(())
}
impl Workspace {
    fn execute_read_stages(&self, p: &Value) -> Result<Value, String> {
        validate_stages(p)?;
        let mut results = vec![];
        let mut output_bytes = 0usize;
        for stage in p["stages"].as_array().ok_or("INVALID")? {
            let start = Instant::now();
            let output = match stage["action"].as_str().ok_or("INVALID")? {
                "quanta.query" => self.execute(json!({"op":"snapshot"}))?,
                "market.searchOffers" => {
                    let net = self.execute(json!({"op":"domainNetwork"}))?;
                    json!({"items":net["offers"],"scope":"current_authorized_account"})
                }
                "world.timeQuery" => {
                    let mut command = stage.get("input").cloned().unwrap_or_else(|| json!({}));
                    command["op"] = json!("worldTimeQuery");
                    self.execute(command)?
                }
                _ => return Err("UNSUPPORTED".into()),
            };
            output_bytes = output_bytes
                .saturating_add(serde_json::to_vec(&output).map_err(|_| "INVALID")?.len())
                .saturating_add(1024);
            if output_bytes > 1024 * 1024 {
                return Err("RESOURCE_LIMIT".into());
            }
            results.push(json!({"id":stage["id"],"action":stage["action"],"status":"completed","durationMicros":start.elapsed().as_micros() as u64,"outputDigest":fingerprint(&output),"output":output}));
        }
        Ok(json!(results))
    }
    pub(super) fn qh_validate_workflow(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "key", "workflowId", "expected"])?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        if self.metadata(QH_EVALS)?.len() >= 64 {
            return Err("RESOURCE_LIMIT".into());
        }
        let key = parse(&input["key"])?;
        let id = parse(&input["workflowId"])?;
        let (revision, mut workflow) = self.cen_row(id, QH_FLOWS)?;
        if input["expected"].as_u64() != Some(revision) {
            return Err("CONFLICT".into());
        }
        let start = Instant::now();
        let results = self.execute_read_stages(&workflow)?;
        let digest = definition_digest(&workflow);
        let eval_id = derive("qh-workflow-eval", &key.0);
        let count = results.as_array().ok_or("INVALID")?.len();
        let evaluation = json!({"kind":"qh-eval","title":"Read workflow validation","suite":"qharness-read-workflow-v1","evidenceVersion":1,"status":"passed","scope":"native_read_only_definition_validation","workflowId":id.to_canonical_string(),"testedRevision":revision,"definitionDigest":digest,"scenarioCount":count,"executedCount":count,"passedCount":count,"failedCount":0,"notRunCount":0,"durationMicros":start.elapsed().as_micros() as u64,"scenarios":results.as_array().ok_or("INVALID")?.iter().map(|r|json!({"id":r["id"],"name":r["action"],"status":"passed","passed":true,"durationMicros":r["durationMicros"],"observations":[{"check":"authorized_native_read_completed","passed":true,"outputDigest":r["outputDigest"]}]})).collect::<Vec<_>>(),"releaseStatus":"REVIEW_PENDING","updatedAtMs":now_ms()?});
        workflow["status"] = json!("validated_read_only");
        workflow["validatedDefinitionDigest"] = json!(digest);
        workflow["validationEvaluationId"] = json!(eval_id.to_canonical_string());
        workflow["validatedByEval"] = json!(true);
        workflow["updatedAtMs"] = json!(now_ms()?);
        let admission = derive("domain-admit", &key.0);
        receipt(self.db_mut()?.commit(Batch{domain:self.domain,principal:self.owner,key,heads:vec![Head{statement:id,expected:Some(revision)},Head{statement:eval_id,expected:None},Head{statement:admission,expected:None}],mutations:vec![Mutation::Put(qh_statement(id,QH_FLOWS,&workflow,vec![],Epistemic::Authoritative,None)?),Mutation::Put(qh_statement(eval_id,QH_EVALS,&evaluation,vec![(ROLE_LINK,id)],Epistemic::Derived,None)?),Mutation::Put(statement(admission,DOMAIN_ADMIT,&json!({"requestHash":fingerprint(&input),"resultId":id.to_canonical_string()})))],content:vec![]}),id)
    }
    pub(super) fn qh_execute_read_workflow(&self, input: &Value) -> Result<Value, String> {
        allowed(
            input,
            &[
                "op",
                "key",
                "operation",
                "execution",
                "workflowId",
                "mandateId",
                "budget",
            ],
        )?;
        if input["operation"] != "execute" || input["execution"]["interaction"] != "sync" {
            return Err("UNSUPPORTED".into());
        }
        let id = parse(&input["workflowId"])?;
        let (revision, p) = self.cen_row(id, QH_FLOWS)?;
        if p["status"] != "validated_read_only"
            || p["validatedDefinitionDigest"] != definition_digest(&p)
        {
            return Err("PERMISSION_DENIED".into());
        }
        let (_, eval) = self.cen_row(parse(&p["validationEvaluationId"])?, QH_EVALS)?;
        if eval["evidenceVersion"] != 1
            || eval["suite"] != "qharness-read-workflow-v1"
            || eval["definitionDigest"] != definition_digest(&p)
            || eval["workflowId"] != input["workflowId"]
            || eval["status"] != "passed"
        {
            return Err("PERMISSION_DENIED".into());
        }
        let stage_count = p["stages"].as_array().ok_or("INVALID")?.len() as u64;
        if let Some(budget) = input.get("budget") {
            allowed(budget, &["maxToolCalls"])?;
            if budget
                .get("maxToolCalls")
                .is_some_and(|v| v.as_u64().is_none_or(|n| n < stage_count))
            {
                return Err("RESOURCE_LIMIT".into());
            }
        }
        // A restricted mandate must explicitly permit every stage. Recheck ancestry now.
        if let Some(mid) = input.get("mandateId").filter(|v| !v.is_null()) {
            let (_, mandate) = self.qh_active_mandate(parse(mid)?)?;
            if mandate["budget"]["maxToolCalls"]
                .as_u64()
                .is_none_or(|n| n < stage_count)
            {
                return Err("RESOURCE_LIMIT".into());
            }
            let caps = mandate["permittedCapabilities"]
                .as_array()
                .ok_or("PERMISSION_DENIED")?;
            if !mandate["permittedEffects"]
                .as_array()
                .ok_or("PERMISSION_DENIED")?
                .contains(&json!("read"))
                || !mandate["permittedResources"]
                    .as_array()
                    .ok_or("PERMISSION_DENIED")?
                    .is_empty()
            {
                return Err("PERMISSION_DENIED".into());
            }
            for s in p["stages"].as_array().ok_or("INVALID")? {
                if !caps.contains(&s["action"]) {
                    return Err("PERMISSION_DENIED".into());
                }
            }
        }
        let stages = self.execute_read_stages(&p)?;
        Ok(
            json!({"status":"completed","executionMode":"native_read_only","workflowId":id.to_canonical_string(),"workflowRevision":revision,"definitionDigest":definition_digest(&p),"stages":stages,"usage":{"modelCalls":0,"toolCalls":p["stages"].as_array().ok_or("INVALID")?.len(),"costMinorUnits":0,"currency":"USD"},"missionCreated":false,"agentLoopInvoked":false}),
        )
    }
}
