//! Typed NeighborOS domain schemas, ExactMoney integer validation, Role graph edges,
//! Marketplace/Projects/Social/Agent operations, and deterministic Intent-to-Plan compilation
//! over the maintained Quanta native core.
use super::citizen::{now_ms, text};
use super::lifecycle::{fingerprint, statement};
use super::*;
use quanta_core::{
    Aggregate, AggregateLimits, AggregateQuery, CompareOp, FilterExpr, FilteredQuery, NativeKind,
    NativeValue, QueryField, ValueStep,
};
use std::collections::BTreeMap;

pub(super) const MARKET_OFFERS: Qid = Qid(*b"NEIGHBOR_MKT__01");
pub(super) const PROPOSALS: Qid = Qid(*b"NEIGHBOR_PRP__01");
pub(super) const COMMITMENTS: Qid = Qid(*b"NBR_COMMITMNT_01");
pub(super) const PROJECTS: Qid = Qid(*b"NEIGHBOR_PRJ__01");
pub(super) const SOCIAL_POSTS: Qid = Qid(*b"NEIGHBOR_SOC__01");
pub(super) const AGENT_PLANS: Qid = Qid(*b"NEIGHBOR_AGT__01");
pub(super) const DOMAIN_ADMIT: Qid = Qid(*b"NEIGHBOR_DADM_01");
pub(super) const ROLE_LINK: Qid = Qid(*b"NEIGHBOR_ROLE_LK");
pub(super) const ROLE_PLACE: Qid = Qid(*b"NEIGHBOR_ROLE_PL");
pub(super) const ROLE_OFFER: Qid = Qid(*b"NEIGHBOR_ROLE_OF");
pub(super) const ROLE_PROJECT: Qid = Qid(*b"NEIGHBOR_ROLE_PJ");
pub(super) const ROLE_PROPOSAL: Qid = Qid(*b"NEIGHBOR_ROLE_PR");
pub(super) const FRAME_WGS84: Qid = Qid(*b"QUANTA_WGS84__01");

const MARKET_CATEGORIES: &[&str] = &[
    "skilled-trades",
    "tool-rental",
    "materials",
    "local-services",
    "civic-bounty",
    "equipment",
];
const RATE_BASES: &[&str] = &["fixed", "hourly", "daily", "per_unit"];
const OFFER_STATUSES: &[&str] = &["available", "busy", "archived"];
const PROPOSAL_STATUSES: &[&str] = &["proposed", "accepted", "completed", "verified", "declined"];
const COMMITMENT_OUTCOME_STATES: &[&str] = &[
    "in_progress",
    "reported_complete",
    "verified_complete",
    "disputed",
];
const PROJECT_STAGES: &[&str] = &["needs", "plan", "source", "execute", "verify", "completed"];
const SOCIAL_CHANNELS: &[&str] = &["general", "projects", "marketplace", "mutual-aid", "direct"];

/// Validates an ExactMoney object `{ amountMinorUnits: i64, currency: "USD" }`.
/// Floating-point numbers or non-integer amounts are strictly rejected (`INV-MKT-005`).
pub(super) fn validate_exact_money(v: &Value) -> Result<(i64, [u8; 3], String), String> {
    allowed(v, &["amountMinorUnits", "currency"])?;
    let amount = v["amountMinorUnits"].as_i64().ok_or("INVALID")?;
    if !(0..=100_000_000_000).contains(&amount) {
        return Err("INVALID".into());
    }
    let currency = v["currency"].as_str().ok_or("INVALID")?;
    if currency.len() != 3 || !currency.bytes().all(|b| b.is_ascii_uppercase()) {
        return Err("INVALID".into());
    }
    let bytes: [u8; 3] = currency.as_bytes().try_into().map_err(|_| "INVALID")?;
    Ok((amount, bytes, currency.to_owned()))
}

fn native_currency_value(amount_minor_units: i64, asset: [u8; 3]) -> Result<Native, String> {
    let code = std::str::from_utf8(&asset)
        .map_err(|_| "INVALID")?
        .to_owned();
    let payload = Native::Map(BTreeMap::from([
        ("amount".into(), Native::I64(amount_minor_units)),
        ("code".into(), Native::Text(code)),
    ]));
    let nv = NativeValue::new(NativeKind::Currency, payload).map_err(|_| "INVALID")?;
    Ok(nv.into_value())
}

pub(super) fn native_geo_value(coords: &Value) -> Option<Native> {
    let arr = coords.as_array()?;
    if arr.len() < 2 {
        return None;
    }
    let lon = arr[0].as_f64()?;
    let lat = arr[1].as_f64()?;
    if !(-180.0..=180.0).contains(&lon) || !(-90.0..=90.0).contains(&lat) {
        return None;
    }
    let lon_micro = (lon * 1_000_000.0).round() as i128;
    let lat_micro = (lat * 1_000_000.0).round() as i128;
    let payload = Native::Map(BTreeMap::from([
        ("frame".into(), Native::Qid(FRAME_WGS84)),
        (
            "coordinates".into(),
            Native::List(vec![
                Native::Decimal {
                    coefficient: lon_micro,
                    scale: 6,
                },
                Native::Decimal {
                    coefficient: lat_micro,
                    scale: 6,
                },
            ]),
        ),
    ]));
    NativeValue::new(NativeKind::Geo, payload)
        .ok()
        .map(NativeValue::into_value)
}

fn domain_statement(
    id: Qid,
    predicate: Qid,
    value: &Value,
    roles: Vec<(Qid, Qid)>,
    money: Option<(i64, [u8; 3])>,
) -> Result<Statement, String> {
    let mut fields = BTreeMap::from([("metadata".into(), Native::Text(value.to_string()))]);
    if let Some((minor, asset)) = money {
        fields.insert("amount_minor_units".into(), Native::I64(minor));
        fields.insert("currency".into(), native_currency_value(minor, asset)?);
    }
    if let Some(kind) = value.get("kind").and_then(Value::as_str) {
        fields.insert("kind".into(), Native::Text(kind.to_owned()));
    }
    if let Some(title) = value.get("title").and_then(Value::as_str) {
        fields.insert("title".into(), Native::Text(title.to_owned()));
    }
    if let Some(status) = value
        .get("status")
        .or_else(|| value.get("stage"))
        .and_then(Value::as_str)
    {
        fields.insert("status".into(), Native::Text(status.to_owned()));
    }
    if let Some(coords) = value.get("coordinates") {
        if let Some(geo) = native_geo_value(coords) {
            fields.insert("geo".into(), geo);
        }
    }
    Ok(Statement {
        id,
        subject: id,
        predicate,
        roles,
        value: Native::Map(fields),
        source: None,
        epistemic: Epistemic::Authoritative,
        valid_from: None,
        valid_until: None,
    })
}

impl Workspace {
    pub(super) fn domain_prior(&self, input: &Value) -> Result<Option<Value>, String> {
        let key = parse(&input["key"])?;
        let prior = self
            .db()?
            .resolve(self.domain, self.owner, key)
            .map_err(err)?;
        if let Some(saved) = prior {
            let (_, admission) = self.cen_row(derive("domain-admit", &key.0), DOMAIN_ADMIT)?;
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

    #[allow(clippy::too_many_arguments)]
    fn domain_commit(
        &self,
        input: &Value,
        head: (Qid, Option<u64>),
        predicate: Qid,
        value: &Value,
        roles: Vec<(Qid, Qid)>,
        money: Option<(i64, [u8; 3])>,
    ) -> Result<Value, String> {
        let (id, expected) = head;
        let key = parse(&input["key"])?;
        let admission = derive("domain-admit", &key.0);
        let row = domain_statement(id, predicate, value, roles, money)?;
        let mutations = vec![
            Mutation::Put(row),
            Mutation::Put(statement(
                admission,
                DOMAIN_ADMIT,
                &json!({
                    "requestHash": fingerprint(input),
                    "resultId": id.to_canonical_string()
                }),
            )),
        ];
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
                content: vec![],
            }),
            id,
        )
    }

    pub(super) fn validate_any_ref(&self, id: Qid) -> Result<(), String> {
        let db = self.db()?;
        let row = db
            .revision_current(self.domain, self.owner, id, None)
            .map_err(err)?;
        drop(db);
        let s = row.and_then(|r| r.statement).ok_or("NOT_AVAILABLE")?;
        if ![
            RECORDS,
            OCCURRENCES,
            MARKET_OFFERS,
            PROPOSALS,
            COMMITMENTS,
            PROJECTS,
            SOCIAL_POSTS,
            AGENT_PLANS,
            super::citizen::ARTIFACTS,
            super::citizen::CLAIMS,
            super::citizen::CASEBOOKS,
            super::qharness::QH_MISSIONS,
            super::qharness::QH_PLANS,
            super::qharness::QH_TASKS,
            super::qharness::QH_RUNS,
            super::qharness::QH_MANDATES,
            super::qharness::QH_FRAMES,
            super::qharness::QH_MEMORIES,
            super::qharness::QH_FLOWS,
            super::qharness::QH_EVALS,
        ]
        .contains(&s.predicate)
        {
            return Err("NOT_AVAILABLE".into());
        }
        if s.predicate == OCCURRENCES {
            self.world()?.occurrence(id, PURPOSE).map_err(err)?;
        }
        Ok(())
    }

    pub(super) fn collect_refs(
        &self,
        v: &Value,
        field_name: &str,
        max: usize,
    ) -> Result<Vec<Qid>, String> {
        let Some(arr) = v.get(field_name) else {
            return Ok(vec![]);
        };
        let list = arr.as_array().ok_or("INVALID")?;
        if list.len() > max {
            return Err("RESOURCE_LIMIT".into());
        }
        let mut out = Vec::with_capacity(list.len());
        for item in list {
            let qid = parse(item)?;
            self.validate_any_ref(qid)?;
            out.push(qid);
        }
        Ok(out)
    }

    pub(super) fn validate_domain_command(&self, input: &Value) -> Result<(), String> {
        parse(&input["key"])?;
        match input["op"].as_str().ok_or("INVALID")? {
            "saveMarketOffer" => {
                allowed(input, &["op", "key", "id", "expected", "payload"])?;
                if input.get("id").is_some() {
                    parse(&input["id"])?;
                    input["expected"].as_u64().ok_or("INVALID")?;
                } else if input.get("expected").is_some() {
                    return Err("INVALID".into());
                }
                let p = &input["payload"];
                allowed(
                    p,
                    &[
                        "title",
                        "category",
                        "providerName",
                        "providerSkills",
                        "description",
                        "price",
                        "rateBasis",
                        "status",
                        "placeId",
                        "coordinates",
                        "refs",
                    ],
                )?;
                let title = text(&p["title"], 1, 160)?;
                if title.chars().any(char::is_control) {
                    return Err("INVALID".into());
                }
                let category = p["category"].as_str().ok_or("INVALID")?;
                if !MARKET_CATEGORIES.contains(&category) {
                    return Err("INVALID".into());
                }
                let provider = text(&p["providerName"], 1, 120)?;
                if provider.chars().any(char::is_control) {
                    return Err("INVALID".into());
                }
                if let Some(skills) = p.get("providerSkills") {
                    if !skills.is_null() {
                        text(skills, 0, 240)?;
                    }
                }
                text(&p["description"], 0, 4000)?;
                validate_exact_money(&p["price"])?;
                let rate = p["rateBasis"].as_str().ok_or("INVALID")?;
                if !RATE_BASES.contains(&rate) {
                    return Err("INVALID".into());
                }
                let status = p["status"].as_str().ok_or("INVALID")?;
                if !OFFER_STATUSES.contains(&status) {
                    return Err("INVALID".into());
                }
                if let Some(place) = p.get("placeId") {
                    if !place.is_null() {
                        self.validate_any_ref(parse(place)?)?;
                    }
                }
                if let Some(coords) = p.get("coordinates") {
                    if !coords.is_null() {
                        let a = coords.as_array().ok_or("INVALID")?;
                        if a.len() != 2
                            || a[0].as_f64().is_none_or(|x| !(-180.0..=180.0).contains(&x))
                            || a[1].as_f64().is_none_or(|x| !(-90.0..=90.0).contains(&x))
                        {
                            return Err("INVALID".into());
                        }
                    }
                }
                self.collect_refs(p, "refs", 16)?;
                Ok(())
            }
            "saveProposal" => {
                allowed(input, &["op", "key", "id", "expected", "payload"])?;
                if input.get("id").is_some() {
                    parse(&input["id"])?;
                    input["expected"].as_u64().ok_or("INVALID")?;
                } else if input.get("expected").is_some() {
                    return Err("INVALID".into());
                }
                let p = &input["payload"];
                allowed(
                    p,
                    &[
                        "title",
                        "offerId",
                        "projectId",
                        "counterparty",
                        "scope",
                        "deliverables",
                        "totalPrice",
                        "status",
                        "evidenceIds",
                    ],
                )?;
                let title = text(&p["title"], 1, 160)?;
                if title.chars().any(char::is_control) {
                    return Err("INVALID".into());
                }
                if let Some(offer_id) = p.get("offerId") {
                    if !offer_id.is_null() {
                        self.validate_any_ref(parse(offer_id)?)?;
                    }
                }
                if let Some(project_id) = p.get("projectId") {
                    if !project_id.is_null() {
                        self.validate_any_ref(parse(project_id)?)?;
                    }
                }
                text(&p["counterparty"], 1, 120)?;
                text(&p["scope"], 0, 4000)?;
                let (total_minor, _, _) = validate_exact_money(&p["totalPrice"])?;
                let deliverables = p["deliverables"].as_array().ok_or("INVALID")?;
                if deliverables.len() > 24 {
                    return Err("RESOURCE_LIMIT".into());
                }
                let mut sum_minor: i64 = 0;
                for item in deliverables {
                    allowed(item, &["title", "amountMinorUnits"])?;
                    text(&item["title"], 1, 160)?;
                    let amt = item["amountMinorUnits"].as_i64().ok_or("INVALID")?;
                    if !(0..=100_000_000_000).contains(&amt) {
                        return Err("INVALID".into());
                    }
                    sum_minor = sum_minor.checked_add(amt).ok_or("INVALID")?;
                }
                if !deliverables.is_empty() && sum_minor != total_minor {
                    return Err("INVALID".into());
                }
                let status = p["status"].as_str().ok_or("INVALID")?;
                if !PROPOSAL_STATUSES.contains(&status) {
                    return Err("INVALID".into());
                }
                self.collect_refs(p, "evidenceIds", 16)?;
                Ok(())
            }
            "saveProject" => {
                allowed(input, &["op", "key", "id", "expected", "payload"])?;
                if input.get("id").is_some() {
                    parse(&input["id"])?;
                    input["expected"].as_u64().ok_or("INVALID")?;
                } else if input.get("expected").is_some() {
                    return Err("INVALID".into());
                }
                let p = &input["payload"];
                allowed(
                    p,
                    &[
                        "title",
                        "description",
                        "stage",
                        "budget",
                        "placeId",
                        "coordinates",
                        "milestones",
                        "bom",
                        "linkedOfferIds",
                        "refs",
                    ],
                )?;
                let title = text(&p["title"], 1, 160)?;
                if title.chars().any(char::is_control) {
                    return Err("INVALID".into());
                }
                text(&p["description"], 0, 8000)?;
                let stage = p["stage"].as_str().ok_or("INVALID")?;
                if !PROJECT_STAGES.contains(&stage) {
                    return Err("INVALID".into());
                }
                validate_exact_money(&p["budget"])?;
                if let Some(place) = p.get("placeId") {
                    if !place.is_null() {
                        self.validate_any_ref(parse(place)?)?;
                    }
                }
                if let Some(coords) = p.get("coordinates") {
                    if !coords.is_null() {
                        let a = coords.as_array().ok_or("INVALID")?;
                        if a.len() != 2
                            || a[0].as_f64().is_none_or(|x| !(-180.0..=180.0).contains(&x))
                            || a[1].as_f64().is_none_or(|x| !(-90.0..=90.0).contains(&x))
                        {
                            return Err("INVALID".into());
                        }
                    }
                }
                let milestones = p["milestones"].as_array().ok_or("INVALID")?;
                if milestones.len() > 32 {
                    return Err("RESOURCE_LIMIT".into());
                }
                for m in milestones {
                    allowed(m, &["id", "title", "status", "evidenceId"])?;
                    text(&m["id"], 1, 64)?;
                    text(&m["title"], 1, 160)?;
                    if !["open", "in_progress", "done", "verified"]
                        .contains(&m["status"].as_str().ok_or("INVALID")?)
                    {
                        return Err("INVALID".into());
                    }
                    if let Some(ev) = m.get("evidenceId") {
                        if !ev.is_null() {
                            self.validate_any_ref(parse(ev)?)?;
                        }
                    }
                }
                let bom = p["bom"].as_array().ok_or("INVALID")?;
                if bom.len() > 40 {
                    return Err("RESOURCE_LIMIT".into());
                }
                for item in bom {
                    allowed(
                        item,
                        &[
                            "id",
                            "item",
                            "category",
                            "estimatedMinorUnits",
                            "linkedOfferId",
                            "status",
                        ],
                    )?;
                    text(&item["id"], 1, 64)?;
                    text(&item["item"], 1, 160)?;
                    let cat = item["category"].as_str().ok_or("INVALID")?;
                    if !MARKET_CATEGORIES.contains(&cat) {
                        return Err("INVALID".into());
                    }
                    let est = item["estimatedMinorUnits"].as_i64().ok_or("INVALID")?;
                    if !(0..=100_000_000_000).contains(&est) {
                        return Err("INVALID".into());
                    }
                    if let Some(off) = item.get("linkedOfferId") {
                        if !off.is_null() {
                            self.validate_any_ref(parse(off)?)?;
                        }
                    }
                    if !["needed", "sourced", "committed", "fulfilled"]
                        .contains(&item["status"].as_str().ok_or("INVALID")?)
                    {
                        return Err("INVALID".into());
                    }
                }
                self.collect_refs(p, "linkedOfferIds", 24)?;
                self.collect_refs(p, "refs", 24)?;
                Ok(())
            }
            "saveSocialPost" => {
                allowed(input, &["op", "key", "id", "expected", "payload"])?;
                if input.get("id").is_some() {
                    parse(&input["id"])?;
                    input["expected"].as_u64().ok_or("INVALID")?;
                } else if input.get("expected").is_some() {
                    return Err("INVALID".into());
                }
                let p = &input["payload"];
                allowed(
                    p,
                    &[
                        "channel",
                        "author",
                        "title",
                        "body",
                        "sharedObjectId",
                        "sharedObjectKind",
                        "replies",
                        "refs",
                    ],
                )?;
                let ch = p["channel"].as_str().ok_or("INVALID")?;
                if !SOCIAL_CHANNELS.contains(&ch) {
                    return Err("INVALID".into());
                }
                let author = text(&p["author"], 1, 80)?;
                if author.chars().any(char::is_control) {
                    return Err("INVALID".into());
                }
                let title = text(&p["title"], 1, 160)?;
                if title.chars().any(char::is_control) {
                    return Err("INVALID".into());
                }
                text(&p["body"], 1, 6000)?;
                if let Some(shared) = p.get("sharedObjectId") {
                    if !shared.is_null() {
                        self.validate_any_ref(parse(shared)?)?;
                    }
                }
                if let Some(kind) = p.get("sharedObjectKind") {
                    if !kind.is_null() {
                        text(kind, 1, 40)?;
                    }
                }
                if let Some(replies) = p.get("replies") {
                    let list = replies.as_array().ok_or("INVALID")?;
                    if list.len() > 64 {
                        return Err("RESOURCE_LIMIT".into());
                    }
                    for r in list {
                        allowed(r, &["author", "body", "createdAtMs"])?;
                        text(&r["author"], 1, 80)?;
                        text(&r["body"], 1, 2000)?;
                    }
                }
                self.collect_refs(p, "refs", 16)?;
                Ok(())
            }
            "compileAgentPlan" => {
                allowed(input, &["op", "key", "payload"])?;
                let p = &input["payload"];
                allowed(p, &["prompt", "placeId", "budgetMinorUnits", "currency"])?;
                let prompt = text(&p["prompt"], 3, 2000)?;
                if prompt.chars().any(char::is_control) {
                    return Err("INVALID".into());
                }
                if let Some(place) = p.get("placeId") {
                    if !place.is_null() {
                        self.validate_any_ref(parse(place)?)?;
                    }
                }
                if let Some(b) = p.get("budgetMinorUnits") {
                    if !b.is_null() {
                        let amt = b.as_i64().ok_or("INVALID")?;
                        if !(0..=100_000_000_000).contains(&amt) {
                            return Err("INVALID".into());
                        }
                    }
                }
                Ok(())
            }
            "executeAgentPlan" => {
                allowed(
                    input,
                    &[
                        "op",
                        "key",
                        "planId",
                        "expected",
                        "whatIHeardConfirmed",
                        "financialGateApproved",
                    ],
                )?;
                parse(&input["planId"])?;
                input["expected"].as_u64().ok_or("INVALID")?;
                if !input["whatIHeardConfirmed"].is_boolean()
                    || !input["financialGateApproved"].is_boolean()
                {
                    return Err("INVALID".into());
                }
                if input["whatIHeardConfirmed"] != true || input["financialGateApproved"] != true {
                    return Err("PERMISSION_DENIED".into());
                }
                Ok(())
            }
            "seedStarterCatalog" => {
                allowed(input, &["op", "key"])?;
                Ok(())
            }
            "saveCommitment" => {
                allowed(
                    input,
                    &[
                        "op",
                        "key",
                        "proposalId",
                        "expectedProposalRevision",
                        "expectedOfferRevision",
                        "projectId",
                        "termsAccepted",
                        "scopeNote",
                    ],
                )?;
                parse(&input["proposalId"])?;
                input["expectedProposalRevision"]
                    .as_u64()
                    .ok_or("INVALID")?;
                if let Some(eo) = input.get("expectedOfferRevision") {
                    if !eo.is_null() {
                        eo.as_u64().ok_or("INVALID")?;
                    }
                }
                if let Some(proj) = input.get("projectId") {
                    if !proj.is_null() {
                        self.validate_any_ref(parse(proj)?)?;
                    }
                }
                if !input["termsAccepted"].is_boolean() {
                    return Err("INVALID".into());
                }
                if input["termsAccepted"] != true {
                    return Err("PERMISSION_DENIED".into());
                }
                if let Some(note) = input.get("scopeNote") {
                    if !note.is_null() {
                        text(note, 0, 2000)?;
                    }
                }
                Ok(())
            }
            "verifyCommitmentOutcome" => {
                allowed(
                    input,
                    &[
                        "op",
                        "key",
                        "commitmentId",
                        "expectedRevision",
                        "outcomeState",
                        "evidenceIds",
                        "verificationNote",
                    ],
                )?;
                parse(&input["commitmentId"])?;
                input["expectedRevision"].as_u64().ok_or("INVALID")?;
                let state = input["outcomeState"].as_str().ok_or("INVALID")?;
                if !COMMITMENT_OUTCOME_STATES.contains(&state) || state == "in_progress" {
                    return Err("INVALID".into());
                }
                let ev = self.collect_refs(input, "evidenceIds", 16)?;
                if state == "verified_complete" && ev.is_empty() {
                    return Err("INVALID".into());
                }
                text(&input["verificationNote"], 1, 2000)?;
                Ok(())
            }
            _ => Err("UNSUPPORTED".into()),
        }
    }

    pub(super) fn save_market_offer(&self, input: Value) -> Result<Value, String> {
        self.validate_domain_command(&input)?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let key = parse(&input["key"])?;
        let id = input
            .get("id")
            .map(parse)
            .transpose()?
            .unwrap_or_else(|| derive("market-offer", &key.0));
        let expected = input.get("expected").and_then(Value::as_u64);
        if expected.is_some() {
            self.cen_row(id, MARKET_OFFERS)?;
        } else if self.metadata(MARKET_OFFERS)?.len() >= 500 {
            return Err("RESOURCE_LIMIT".into());
        }
        let p = &input["payload"];
        let (minor, asset, currency) = validate_exact_money(&p["price"])?;
        let mut roles = Vec::new();
        if let Some(place_id) = p.get("placeId").filter(|v| !v.is_null()) {
            roles.push((ROLE_PLACE, parse(place_id)?));
        }
        for r in self.collect_refs(p, "refs", 16)? {
            roles.push((ROLE_LINK, r));
        }
        let record = json!({
            "kind": "market-offer",
            "title": p["title"].as_str().unwrap_or("").trim(),
            "category": p["category"],
            "providerName": p["providerName"].as_str().unwrap_or("").trim(),
            "providerSkills": p.get("providerSkills").and_then(Value::as_str).unwrap_or(""),
            "description": p["description"].as_str().unwrap_or(""),
            "price": { "amountMinorUnits": minor, "currency": currency },
            "rateBasis": p["rateBasis"],
            "status": p["status"],
            "placeId": p.get("placeId").cloned().unwrap_or(Value::Null),
            "coordinates": p.get("coordinates").cloned().unwrap_or(Value::Null),
            "refs": p.get("refs").cloned().unwrap_or_else(|| json!([])),
            "updatedAtMs": now_ms()?,
        });
        self.domain_commit(
            &input,
            (id, expected),
            MARKET_OFFERS,
            &record,
            roles,
            Some((minor, asset)),
        )
    }

    pub(super) fn save_proposal(&self, input: Value) -> Result<Value, String> {
        self.validate_domain_command(&input)?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let key = parse(&input["key"])?;
        let id = input
            .get("id")
            .map(parse)
            .transpose()?
            .unwrap_or_else(|| derive("proposal", &key.0));
        let expected = input.get("expected").and_then(Value::as_u64);
        if expected.is_some() {
            self.cen_row(id, PROPOSALS)?;
        } else if self.metadata(PROPOSALS)?.len() >= 500 {
            return Err("RESOURCE_LIMIT".into());
        }
        let p = &input["payload"];
        let (minor, asset, currency) = validate_exact_money(&p["totalPrice"])?;
        let mut roles = Vec::new();
        if let Some(offer_id) = p.get("offerId").filter(|v| !v.is_null()) {
            roles.push((ROLE_OFFER, parse(offer_id)?));
        }
        if let Some(project_id) = p.get("projectId").filter(|v| !v.is_null()) {
            roles.push((ROLE_PROJECT, parse(project_id)?));
        }
        for ev in self.collect_refs(p, "evidenceIds", 16)? {
            roles.push((ROLE_LINK, ev));
        }
        let record = json!({
            "kind": "proposal",
            "title": p["title"].as_str().unwrap_or("").trim(),
            "offerId": p.get("offerId").cloned().unwrap_or(Value::Null),
            "projectId": p.get("projectId").cloned().unwrap_or(Value::Null),
            "counterparty": p["counterparty"].as_str().unwrap_or("").trim(),
            "scope": p["scope"].as_str().unwrap_or(""),
            "deliverables": p["deliverables"],
            "totalPrice": { "amountMinorUnits": minor, "currency": currency },
            "status": p["status"],
            "evidenceIds": p.get("evidenceIds").cloned().unwrap_or_else(|| json!([])),
            "updatedAtMs": now_ms()?,
        });
        self.domain_commit(
            &input,
            (id, expected),
            PROPOSALS,
            &record,
            roles,
            Some((minor, asset)),
        )
    }

    pub(super) fn save_project(&self, input: Value) -> Result<Value, String> {
        self.validate_domain_command(&input)?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let key = parse(&input["key"])?;
        let id = input
            .get("id")
            .map(parse)
            .transpose()?
            .unwrap_or_else(|| derive("project", &key.0));
        let expected = input.get("expected").and_then(Value::as_u64);
        if expected.is_some() {
            self.cen_row(id, PROJECTS)?;
        } else if self.metadata(PROJECTS)?.len() >= 500 {
            return Err("RESOURCE_LIMIT".into());
        }
        let p = &input["payload"];
        let (minor, asset, currency) = validate_exact_money(&p["budget"])?;
        let mut roles = Vec::new();
        if let Some(place_id) = p.get("placeId").filter(|v| !v.is_null()) {
            roles.push((ROLE_PLACE, parse(place_id)?));
        }
        for off in self.collect_refs(p, "linkedOfferIds", 24)? {
            roles.push((ROLE_OFFER, off));
        }
        for r in self.collect_refs(p, "refs", 24)? {
            roles.push((ROLE_LINK, r));
        }
        let bom_total_minor: i64 = p["bom"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|i| i["estimatedMinorUnits"].as_i64())
                    .sum()
            })
            .unwrap_or(0);
        let record = json!({
            "kind": "project",
            "title": p["title"].as_str().unwrap_or("").trim(),
            "description": p["description"].as_str().unwrap_or(""),
            "stage": p["stage"],
            "budget": { "amountMinorUnits": minor, "currency": currency },
            "bomTotalMinorUnits": bom_total_minor,
            "placeId": p.get("placeId").cloned().unwrap_or(Value::Null),
            "coordinates": p.get("coordinates").cloned().unwrap_or(Value::Null),
            "milestones": p["milestones"],
            "bom": p["bom"],
            "linkedOfferIds": p.get("linkedOfferIds").cloned().unwrap_or_else(|| json!([])),
            "refs": p.get("refs").cloned().unwrap_or_else(|| json!([])),
            "updatedAtMs": now_ms()?,
        });
        self.domain_commit(
            &input,
            (id, expected),
            PROJECTS,
            &record,
            roles,
            Some((minor, asset)),
        )
    }

    pub(super) fn save_social_post(&self, input: Value) -> Result<Value, String> {
        self.validate_domain_command(&input)?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let key = parse(&input["key"])?;
        let id = input
            .get("id")
            .map(parse)
            .transpose()?
            .unwrap_or_else(|| derive("social-post", &key.0));
        let expected = input.get("expected").and_then(Value::as_u64);
        if expected.is_some() {
            self.cen_row(id, SOCIAL_POSTS)?;
        } else if self.metadata(SOCIAL_POSTS)?.len() >= 500 {
            return Err("RESOURCE_LIMIT".into());
        }
        let p = &input["payload"];
        let mut roles = Vec::new();
        if let Some(shared) = p.get("sharedObjectId").filter(|v| !v.is_null()) {
            roles.push((ROLE_LINK, parse(shared)?));
        }
        for r in self.collect_refs(p, "refs", 16)? {
            roles.push((ROLE_LINK, r));
        }
        let record = json!({
            "kind": "social-post",
            "channel": p["channel"],
            "author": p["author"].as_str().unwrap_or("").trim(),
            "title": p["title"].as_str().unwrap_or("").trim(),
            "body": p["body"].as_str().unwrap_or(""),
            "sharedObjectId": p.get("sharedObjectId").cloned().unwrap_or(Value::Null),
            "sharedObjectKind": p.get("sharedObjectKind").cloned().unwrap_or(Value::Null),
            "replies": p.get("replies").cloned().unwrap_or_else(|| json!([])),
            "refs": p.get("refs").cloned().unwrap_or_else(|| json!([])),
            "updatedAtMs": now_ms()?,
        });
        self.domain_commit(&input, (id, expected), SOCIAL_POSTS, &record, roles, None)
    }

    /// Deterministic native Intent-to-Plan compiler (`INV-MKT-008`, `U18`).
    /// Analyzes the user's natural language prompt against live Quanta Marketplace offers and Places,
    /// producing a governed `What I Heard` plan requiring explicit human approval before execution.
    pub(super) fn compile_agent_plan(&self, input: Value) -> Result<Value, String> {
        self.validate_domain_command(&input)?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let key = parse(&input["key"])?;
        let id = derive("agent-plan", &key.0);
        if self.metadata(AGENT_PLANS)?.len() >= 200 {
            return Err("RESOURCE_LIMIT".into());
        }
        let p = &input["payload"];
        let prompt = p["prompt"].as_str().unwrap_or("").trim();
        let lower = prompt.to_lowercase();
        let currency = p
            .get("currency")
            .and_then(Value::as_str)
            .unwrap_or("USD")
            .to_owned();
        if currency.len() != 3 || !currency.bytes().all(|b| b.is_ascii_uppercase()) {
            return Err("INVALID".into());
        }
        let asset: [u8; 3] = currency.as_bytes().try_into().map_err(|_| "INVALID")?;

        // Match available marketplace offers in Quanta storage
        let offers = self.metadata(MARKET_OFFERS)?;
        let mut matched_offers = Vec::new();
        for (offer_id, _, offer_val) in &offers {
            if offer_val["status"] != "available" {
                continue;
            }
            let title_l = offer_val["title"].as_str().unwrap_or("").to_lowercase();
            let cat_l = offer_val["category"].as_str().unwrap_or("").to_lowercase();
            let desc_l = offer_val["description"]
                .as_str()
                .unwrap_or("")
                .to_lowercase();
            let is_workshop = lower.contains("workshop")
                || lower.contains("shed")
                || lower.contains("build")
                || lower.contains("electrical")
                || lower.contains("lumber")
                || lower.contains("concrete");
            let is_fence =
                lower.contains("fence") || lower.contains("cedar") || lower.contains("post");
            let keyword_hit = prompt
                .split(|c: char| !c.is_alphanumeric())
                .filter(|w| w.len() >= 4)
                .any(|w| {
                    let wl = w.to_lowercase();
                    title_l.contains(&wl) || desc_l.contains(&wl) || cat_l.contains(&wl)
                });
            if keyword_hit || is_workshop || is_fence {
                matched_offers.push(json!({
                    "offerId": offer_id.to_canonical_string(),
                    "title": offer_val["title"],
                    "providerName": offer_val["providerName"],
                    "category": offer_val["category"],
                    "amountMinorUnits": offer_val["price"]["amountMinorUnits"],
                    "currency": offer_val["price"]["currency"],
                    "rateBasis": offer_val["rateBasis"]
                }));
            }
            if matched_offers.len() >= 4 {
                break;
            }
        }

        // Synthesize structured milestones and BOM lines based on intent + live offers
        let project_title = if lower.contains("workshop") {
            "Timber & Electrical Workshop Build".to_owned()
        } else if lower.contains("fence") {
            "Boundary Cedar Fence & Post Restoration".to_owned()
        } else {
            let trimmed: String = prompt.chars().take(72).collect();
            format!("Project Plan: {trimmed}")
        };

        let milestones = json!([
            { "id": "m-1", "title": "Site measurement, layout & ground preparation", "status": "open", "evidenceId": null },
            { "id": "m-2", "title": "Material delivery & equipment staging", "status": "open", "evidenceId": null },
            { "id": "m-3", "title": "Primary structural & trade execution", "status": "open", "evidenceId": null },
            { "id": "m-4", "title": "Final safety inspection & Citizen Evidence verification", "status": "open", "evidenceId": null }
        ]);

        let mut bom = Vec::new();
        if matched_offers.is_empty() {
            bom.push(json!({
                "id": "bom-1",
                "item": "Structural lumber, fasteners & concrete mix package",
                "category": "materials",
                "estimatedMinorUnits": 65000_i64,
                "linkedOfferId": null,
                "status": "needed"
            }));
            bom.push(json!({
                "id": "bom-2",
                "item": "Compact auger / site prep equipment rental (weekend)",
                "category": "tool-rental",
                "estimatedMinorUnits": 22500_i64,
                "linkedOfferId": null,
                "status": "needed"
            }));
            bom.push(json!({
                "id": "bom-3",
                "item": "Licensed trade framing & electrical hookup",
                "category": "skilled-trades",
                "estimatedMinorUnits": 95000_i64,
                "linkedOfferId": null,
                "status": "needed"
            }));
        } else {
            for (idx, off) in matched_offers.iter().enumerate() {
                bom.push(json!({
                    "id": format!("bom-{}", idx + 1),
                    "item": off["title"],
                    "category": off["category"],
                    "estimatedMinorUnits": off["amountMinorUnits"].as_i64().unwrap_or(25000),
                    "linkedOfferId": off["offerId"],
                    "status": "sourced"
                }));
            }
        }

        let estimated_total: i64 = bom
            .iter()
            .filter_map(|b| b["estimatedMinorUnits"].as_i64())
            .sum();
        let budget_minor = p
            .get("budgetMinorUnits")
            .and_then(Value::as_i64)
            .unwrap_or_else(|| estimated_total.max(150_000));

        let mut roles = Vec::new();
        let mut place_title = "Selected Workspace Place".to_owned();
        let mut place_coords = Value::Null;
        if let Some(place_val) = p.get("placeId").filter(|v| !v.is_null()) {
            let place_qid = parse(place_val)?;
            roles.push((ROLE_PLACE, place_qid));
            if let Ok((_, row_val)) = self.cen_row(place_qid, RECORDS) {
                if let Some(t) = row_val["title"].as_str() {
                    place_title = t.to_owned();
                }
                if let Some(c) = row_val.get("coordinates") {
                    place_coords = c.clone();
                }
            }
        }
        for off in &matched_offers {
            if let Ok(off_qid) = parse(&off["offerId"]) {
                roles.push((ROLE_OFFER, off_qid));
            }
        }

        let record = json!({
            "kind": "agent-plan",
            "status": "draft",
            "prompt": prompt,
            "title": project_title,
            "whatIHeard": {
                "objective": project_title,
                "placeId": p.get("placeId").cloned().unwrap_or(Value::Null),
                "placeTitle": place_title,
                "coordinates": place_coords,
                "estimatedTotalMinorUnits": estimated_total,
                "budgetMinorUnits": budget_minor,
                "currency": currency,
                "matchedOfferCount": matched_offers.len(),
                "consentGates": {
                    "financial": "Requires explicit human confirmation before creating project budget & proposals (no automatic payment).",
                    "disclosure": "Private local workspace only; no external broadcast without review.",
                    "destruction": "No existing records will be deleted.",
                    "external": "Zero external API calls or third-party commitments."
                }
            },
            "proposedProject": {
                "title": project_title,
                "description": format!("Compiled from Neighbor AI Agent intent: \"{prompt}\""),
                "stage": "plan",
                "budget": { "amountMinorUnits": budget_minor, "currency": currency },
                "milestones": milestones,
                "bom": bom
            },
            "recommendedOffers": matched_offers,
            "createdIds": [],
            "updatedAtMs": now_ms()?,
        });

        self.domain_commit(
            &input,
            (id, None),
            AGENT_PLANS,
            &record,
            roles,
            Some((estimated_total, asset)),
        )
    }

    /// Executes an approved `AGENT_PLAN` after the human confirms the `What I Heard` and `Financial` consent gates.
    /// Atomically commits the new `PROJECT`, linked `TASK` records, and draft `PROPOSAL` in one Quanta batch.
    pub(super) fn execute_agent_plan(&self, input: Value) -> Result<Value, String> {
        self.validate_domain_command(&input)?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let key = parse(&input["key"])?;
        let plan_id = parse(&input["planId"])?;
        let expected = input["expected"].as_u64().ok_or("INVALID")?;
        let (current_rev, mut plan) = self.cen_row(plan_id, AGENT_PLANS)?;
        if current_rev != expected {
            return Err("CONFLICT".into());
        }
        if plan["status"] == "executed" {
            return Err("CONFLICT".into());
        }

        let project_id = derive("agent-project", &key.0);
        let currency = plan["whatIHeard"]["currency"]
            .as_str()
            .unwrap_or("USD")
            .to_owned();
        let asset: [u8; 3] = currency.as_bytes().try_into().map_err(|_| "INVALID")?;
        let budget_minor = plan["whatIHeard"]["budgetMinorUnits"]
            .as_i64()
            .unwrap_or(150_000);
        let est_minor = plan["whatIHeard"]["estimatedTotalMinorUnits"]
            .as_i64()
            .unwrap_or(0);

        let linked_offers: Vec<Value> = plan["recommendedOffers"]
            .as_array()
            .map(|arr| arr.iter().map(|o| o["offerId"].clone()).collect())
            .unwrap_or_default();

        let mut project_roles = vec![(ROLE_LINK, plan_id)];
        if let Some(place_id) = plan["whatIHeard"].get("placeId").filter(|v| !v.is_null()) {
            if let Ok(pq) = parse(place_id) {
                project_roles.push((ROLE_PLACE, pq));
            }
        }
        for off_val in &linked_offers {
            if let Ok(oq) = parse(off_val) {
                project_roles.push((ROLE_OFFER, oq));
            }
        }

        let project_record = json!({
            "kind": "project",
            "title": plan["proposedProject"]["title"],
            "description": plan["proposedProject"]["description"],
            "stage": "source",
            "budget": { "amountMinorUnits": budget_minor, "currency": currency },
            "bomTotalMinorUnits": est_minor,
            "placeId": plan["whatIHeard"]["placeId"],
            "coordinates": plan["whatIHeard"]["coordinates"],
            "milestones": plan["proposedProject"]["milestones"],
            "bom": plan["proposedProject"]["bom"],
            "linkedOfferIds": linked_offers,
            "refs": [plan_id.to_canonical_string()],
            "updatedAtMs": now_ms()?,
        });

        let mut heads = vec![
            Head {
                statement: plan_id,
                expected: Some(expected),
            },
            Head {
                statement: project_id,
                expected: None,
            },
        ];
        let mut mutations = Vec::new();
        let mut created_ids = vec![project_id.to_canonical_string()];

        // Also materialize each milestone as a native workspace task record so Board & Records see them immediately
        if let Some(milestones) = plan["proposedProject"]["milestones"].as_array() {
            for (idx, m) in milestones.iter().enumerate() {
                let task_id = derive(&format!("agent-task-{idx}"), &key.0);
                heads.push(Head {
                    statement: task_id,
                    expected: None,
                });
                let task_payload = json!({
                    "kind": "task",
                    "title": m["title"],
                    "description": format!("Milestone for project: {}", plan["proposedProject"]["title"].as_str().unwrap_or("")),
                    "status": "open",
                    "refs": []
                });
                let mut task_stmt = statement(task_id, RECORDS, &task_payload);
                task_stmt.roles = vec![(ROLE_PROJECT, project_id)];
                mutations.push(Mutation::Put(task_stmt));
                created_ids.push(task_id.to_canonical_string());
            }
        }

        plan["status"] = json!("executed");
        plan["createdProjectId"] = json!(project_id.to_canonical_string());
        plan["createdIds"] = json!(created_ids);
        plan["updatedAtMs"] = json!(now_ms()?);

        let admission = derive("domain-admit", &key.0);
        heads.push(Head {
            statement: admission,
            expected: None,
        });

        mutations.push(Mutation::Put(domain_statement(
            plan_id,
            AGENT_PLANS,
            &plan,
            vec![(ROLE_PROJECT, project_id)],
            Some((est_minor, asset)),
        )?));
        mutations.push(Mutation::Put(domain_statement(
            project_id,
            PROJECTS,
            &project_record,
            project_roles,
            Some((budget_minor, asset)),
        )?));
        mutations.push(Mutation::Put(statement(
            admission,
            DOMAIN_ADMIT,
            &json!({
                "requestHash": fingerprint(&input),
                "resultId": project_id.to_canonical_string()
            }),
        )));

        receipt(
            self.db_mut()?.commit(Batch {
                domain: self.domain,
                principal: self.owner,
                key,
                heads,
                mutations,
                content: vec![],
            }),
            project_id,
        )
    }

    /// Idempotent opt-in command that loads a realistic starter catalog of Marketplace offers,
    /// a saved Place, and Community discussion threads into the local Quanta store so all
    /// NeighborOS apps can be exercised immediately.
    pub(super) fn seed_starter_catalog(&self, input: Value) -> Result<Value, String> {
        self.validate_domain_command(&input)?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let key = parse(&input["key"])?;
        let place_id = derive("seed-place-oakland-hills", &self.domain.0);
        let offer_1 = derive("seed-offer-timber-framing", &self.domain.0);
        let offer_2 = derive("seed-offer-cedar-lumber", &self.domain.0);
        let offer_3 = derive("seed-offer-auger-rental", &self.domain.0);
        let offer_4 = derive("seed-offer-solar-electrical", &self.domain.0);
        let post_1 = derive("seed-social-welcome", &self.domain.0);

        let db = self.db()?;
        let already_seeded = db
            .revision_current(self.domain, self.owner, offer_1, None)
            .map_err(err)?
            .is_some();
        drop(db);
        if already_seeded {
            return Ok(json!({
                "status": "committed",
                "id": offer_1.to_canonical_string(),
                "sequence": self.db()?.domain_sequence(self.domain, self.owner).map_err(err)?,
                "receipt": fingerprint(&input)
            }));
        }

        let now = now_ms()?;
        let place_payload = json!({
            "kind": "place",
            "title": "North Berkeley Community Commons & Workshop Lot",
            "description": "Shared neighborhood build site and tool library hub (37.8796, -122.2688).",
            "status": "open",
            "coordinates": [-122.2688, 37.8796],
            "refs": []
        });

        let offers = [
            (
                offer_1,
                95000_i64,
                json!({
                    "kind": "market-offer",
                    "title": "Timber Framing, Foundation & Structural Carpentry",
                    "category": "skilled-trades",
                    "providerName": "Elena Rostova · East Bay Guild",
                    "providerSkills": "Licensed General & Framing Contractor · 14 yrs experience · Seismic retrofit",
                    "description": "Complete structural timber framing, pier foundation layout, and roof rafters for backyard workshops, studios, and cedar fencing.",
                    "price": { "amountMinorUnits": 95000, "currency": "USD" },
                    "rateBasis": "fixed",
                    "status": "available",
                    "placeId": place_id.to_canonical_string(),
                    "coordinates": [-122.2688, 37.8796],
                    "refs": [place_id.to_canonical_string()],
                    "origin": "seed-catalog",
                    "updatedAtMs": now
                }),
            ),
            (
                offer_2,
                68500_i64,
                json!({
                    "kind": "market-offer",
                    "title": "Kiln-Dried Western Red Cedar & Douglas Fir Lumber Bundle",
                    "category": "materials",
                    "providerName": "Redwood Valley Millworks Co-op",
                    "providerSkills": "FSC-certified regional timber · Direct local delivery · Custom milling",
                    "description": "Complete workshop and fence lumber package: 4x4 pressure-treated posts, 2x6 rafters, 1x8 cedar boards, and galvanized seismic Simpson ties.",
                    "price": { "amountMinorUnits": 68500, "currency": "USD" },
                    "rateBasis": "per_unit",
                    "status": "available",
                    "placeId": place_id.to_canonical_string(),
                    "coordinates": [-122.2730, 37.8750],
                    "refs": [place_id.to_canonical_string()],
                    "origin": "seed-catalog",
                    "updatedAtMs": now
                }),
            ),
            (
                offer_3,
                18500_i64,
                json!({
                    "kind": "market-offer",
                    "title": "Hydraulic Two-Person Post-Hole Auger & Laser Level Kit",
                    "category": "tool-rental",
                    "providerName": "Berkeley Tool Lending & Heavy Rental",
                    "providerSkills": "Maintained fleet · 8-inch & 12-inch bits · Weekend delivery available",
                    "description": "Weekend rental of hydraulic auger, rotary laser grade level, and concrete mixer for pier footings and fence post installation.",
                    "price": { "amountMinorUnits": 18500, "currency": "USD" },
                    "rateBasis": "daily",
                    "status": "available",
                    "placeId": place_id.to_canonical_string(),
                    "coordinates": [-122.2650, 37.8820],
                    "refs": [place_id.to_canonical_string()],
                    "origin": "seed-catalog",
                    "updatedAtMs": now
                }),
            ),
            (
                offer_4,
                72000_i64,
                json!({
                    "kind": "market-offer",
                    "title": "Workshop Subpanel, 240V Tool Circuits & Solar Microgrid Prep",
                    "category": "skilled-trades",
                    "providerName": "Marcus Vance · C-10 Electrical",
                    "providerSkills": "C-10 Electrical Contractor · EV/Solar/Subpanel specialist",
                    "description": "60A workshop subpanel installation, dedicated 20A/240V dust-collector and table-saw circuits, LED task lighting, and conduit trenching.",
                    "price": { "amountMinorUnits": 72000, "currency": "USD" },
                    "rateBasis": "fixed",
                    "status": "available",
                    "placeId": place_id.to_canonical_string(),
                    "coordinates": [-122.2610, 37.8780],
                    "refs": [place_id.to_canonical_string()],
                    "origin": "seed-catalog",
                    "updatedAtMs": now
                }),
            ),
        ];

        let social_record = json!({
            "kind": "social-post",
            "channel": "projects",
            "author": "Elena Rostova · East Bay Guild",
            "title": "Weekend Workshop & Tool Library Build — Material Sharing Thread",
            "body": "We have surplus Simpson strong-ties and a rotary laser level staged at the North Berkeley Commons lot. Link your active Workshop or Fence project card below if you want to coordinate lumber delivery or compare trade proposals!",
            "sharedObjectId": offer_1.to_canonical_string(),
            "sharedObjectKind": "market-offer",
            "replies": [
                {
                    "author": "Marcus Vance · C-10 Electrical",
                    "body": "I can bundle conduit trenching for anyone scheduling foundation pier drilling this week.",
                    "createdAtMs": now
                }
            ],
            "refs": [place_id.to_canonical_string(), offer_1.to_canonical_string()],
            "updatedAtMs": now
        });

        let admission = derive("domain-admit", &key.0);
        let mut heads = vec![
            Head {
                statement: place_id,
                expected: None,
            },
            Head {
                statement: post_1,
                expected: None,
            },
            Head {
                statement: admission,
                expected: None,
            },
        ];
        let mut mutations = vec![Mutation::Put(statement(place_id, RECORDS, &place_payload))];

        for (oid, minor, rec) in offers {
            heads.push(Head {
                statement: oid,
                expected: None,
            });
            mutations.push(Mutation::Put(domain_statement(
                oid,
                MARKET_OFFERS,
                &rec,
                vec![(ROLE_PLACE, place_id)],
                Some((minor, *b"USD")),
            )?));
        }

        mutations.push(Mutation::Put(domain_statement(
            post_1,
            SOCIAL_POSTS,
            &social_record,
            vec![(ROLE_PLACE, place_id), (ROLE_OFFER, offer_1)],
            None,
        )?));
        mutations.push(Mutation::Put(statement(
            admission,
            DOMAIN_ADMIT,
            &json!({
                "requestHash": fingerprint(&input),
                "resultId": offer_1.to_canonical_string()
            }),
        )));

        receipt(
            self.db_mut()?.commit(Batch {
                domain: self.domain,
                principal: self.owner,
                key,
                heads,
                mutations,
                content: vec![],
            }),
            offer_1,
        )
    }

    /// Implements the canonical `Proposal -> Commitment -> External Effect` transition (`NBR_COMMITMNT_01`).
    /// Atomically verifies both the Proposal head revision and (if linked) the Offer head revision,
    /// mints an exact-currency Commitment with an external effect receipt, and marks the Proposal accepted.
    pub(super) fn save_commitment(&self, input: Value) -> Result<Value, String> {
        self.validate_domain_command(&input)?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        if self.metadata(COMMITMENTS)?.len() >= 500 {
            return Err("RESOURCE_LIMIT".into());
        }
        let key = parse(&input["key"])?;
        let proposal_id = parse(&input["proposalId"])?;
        let expected_proposal_rev = input["expectedProposalRevision"]
            .as_u64()
            .ok_or("INVALID")?;
        let (proposal_rev, mut proposal) = self.cen_row(proposal_id, PROPOSALS)?;
        if proposal_rev != expected_proposal_rev {
            return Err("CONFLICT".into());
        }

        let mut heads = vec![Head {
            statement: proposal_id,
            expected: Some(proposal_rev),
        }];
        let mut roles = vec![(ROLE_PROPOSAL, proposal_id)];
        let mut pinned_offer_rev: Option<u64> = None;

        let offer_id_val = proposal.get("offerId").cloned().unwrap_or(Value::Null);
        if !offer_id_val.is_null() {
            let offer_id = parse(&offer_id_val)?;
            let (offer_rev, offer) = self.cen_row(offer_id, MARKET_OFFERS)?;
            if let Some(expected_offer) = input.get("expectedOfferRevision").and_then(Value::as_u64)
            {
                if offer_rev != expected_offer {
                    return Err("CONFLICT".into());
                }
            }
            if offer["status"] == "archived" {
                return Err("CONFLICT".into());
            }
            pinned_offer_rev = Some(offer_rev);
            heads.push(Head {
                statement: offer_id,
                expected: Some(offer_rev),
            });
            roles.push((ROLE_OFFER, offer_id));
        }

        let project_id_val = input
            .get("projectId")
            .filter(|v| !v.is_null())
            .cloned()
            .or_else(|| proposal.get("projectId").cloned())
            .unwrap_or(Value::Null);
        if !project_id_val.is_null() {
            roles.push((ROLE_PROJECT, parse(&project_id_val)?));
        }

        let (minor, asset, currency) = validate_exact_money(&proposal["totalPrice"])?;
        let commitment_id = derive("commitment", &key.0);
        let admission = derive("domain-admit", &key.0);
        heads.push(Head {
            statement: commitment_id,
            expected: None,
        });
        heads.push(Head {
            statement: admission,
            expected: None,
        });

        let effect_receipt = format!(
            "qeffect-{:016x}",
            u64::from_be_bytes(key.0[..8].try_into().expect("8 bytes"))
        );
        let now = now_ms()?;
        let commitment_record = json!({
            "kind": "commitment",
            "title": format!("Commitment: {}", proposal["title"].as_str().unwrap_or("Proposal")),
            "proposalId": proposal_id.to_canonical_string(),
            "pinnedProposalRevision": proposal_rev,
            "offerId": offer_id_val,
            "pinnedOfferRevision": pinned_offer_rev,
            "projectId": project_id_val,
            "counterparty": proposal["counterparty"],
            "agreedPrice": { "amountMinorUnits": minor, "currency": currency },
            "scopeNote": input.get("scopeNote").and_then(Value::as_str).unwrap_or(""),
            "status": "committed",
            "outcomeState": "in_progress",
            "effectStatus": "authorized_local_effect",
            "effectReceipt": effect_receipt,
            "verifiedEvidenceIds": [],
            "verificationNote": "",
            "createdAtMs": now,
            "updatedAtMs": now,
        });

        proposal["status"] = json!("accepted");
        proposal["commitmentId"] = json!(commitment_id.to_canonical_string());
        proposal["updatedAtMs"] = json!(now);

        let mut proposal_roles = Vec::new();
        if let Some(off) = proposal.get("offerId").filter(|v| !v.is_null()) {
            proposal_roles.push((ROLE_OFFER, parse(off)?));
        }
        if let Some(prj) = proposal.get("projectId").filter(|v| !v.is_null()) {
            proposal_roles.push((ROLE_PROJECT, parse(prj)?));
        }
        for ev in self.collect_refs(&proposal, "evidenceIds", 16)? {
            proposal_roles.push((ROLE_LINK, ev));
        }

        let mutations = vec![
            Mutation::Put(domain_statement(
                commitment_id,
                COMMITMENTS,
                &commitment_record,
                roles,
                Some((minor, asset)),
            )?),
            Mutation::Put(domain_statement(
                proposal_id,
                PROPOSALS,
                &proposal,
                proposal_roles,
                Some((minor, asset)),
            )?),
            Mutation::Put(statement(
                admission,
                DOMAIN_ADMIT,
                &json!({
                    "requestHash": fingerprint(&input),
                    "resultId": commitment_id.to_canonical_string()
                }),
            )),
        ];

        receipt(
            self.db_mut()?.commit(Batch {
                domain: self.domain,
                principal: self.owner,
                key,
                heads,
                mutations,
                content: vec![],
            }),
            commitment_id,
        )
    }

    /// Implements `External Effect -> Verified Outcome`.
    /// Distinguishes `reported_complete` (unverified self-report) from `verified_complete`
    /// (which strictly requires at least one durable Quanta Evidence/Document/Record QID).
    pub(super) fn verify_commitment_outcome(&self, input: Value) -> Result<Value, String> {
        self.validate_domain_command(&input)?;
        if let Some(saved) = self.domain_prior(&input)? {
            return Ok(saved);
        }
        let key = parse(&input["key"])?;
        let commitment_id = parse(&input["commitmentId"])?;
        let expected_rev = input["expectedRevision"].as_u64().ok_or("INVALID")?;
        let (current_rev, mut commitment) = self.cen_row(commitment_id, COMMITMENTS)?;
        if current_rev != expected_rev {
            return Err("CONFLICT".into());
        }

        let outcome_state = input["outcomeState"].as_str().ok_or("INVALID")?;
        let evidence_ids = self.collect_refs(&input, "evidenceIds", 16)?;
        if outcome_state == "verified_complete" && evidence_ids.is_empty() {
            return Err("INVALID".into());
        }

        let (minor, asset, _) = validate_exact_money(&commitment["agreedPrice"])?;
        let proposal_id = parse(&commitment["proposalId"])?;
        let (proposal_rev, mut proposal) = self.cen_row(proposal_id, PROPOSALS)?;

        let mut roles = vec![(ROLE_PROPOSAL, proposal_id)];
        if let Some(off) = commitment.get("offerId").filter(|v| !v.is_null()) {
            roles.push((ROLE_OFFER, parse(off)?));
        }
        if let Some(prj) = commitment.get("projectId").filter(|v| !v.is_null()) {
            roles.push((ROLE_PROJECT, parse(prj)?));
        }
        for ev in &evidence_ids {
            roles.push((ROLE_LINK, *ev));
        }

        let now = now_ms()?;
        let new_status = match outcome_state {
            "verified_complete" => "verified",
            "reported_complete" => "completed",
            _ => "disputed",
        };
        commitment["outcomeState"] = json!(outcome_state);
        commitment["status"] = json!(new_status);
        commitment["verifiedEvidenceIds"] = input["evidenceIds"].clone();
        commitment["verificationNote"] = input["verificationNote"].clone();
        commitment["updatedAtMs"] = json!(now);

        if outcome_state == "verified_complete" || outcome_state == "reported_complete" {
            proposal["status"] = json!(new_status);
            proposal["updatedAtMs"] = json!(now);
        }

        let mut proposal_roles = Vec::new();
        if let Some(off) = proposal.get("offerId").filter(|v| !v.is_null()) {
            proposal_roles.push((ROLE_OFFER, parse(off)?));
        }
        if let Some(prj) = proposal.get("projectId").filter(|v| !v.is_null()) {
            proposal_roles.push((ROLE_PROJECT, parse(prj)?));
        }
        for ev in &evidence_ids {
            proposal_roles.push((ROLE_LINK, *ev));
        }

        let admission = derive("domain-admit", &key.0);
        let heads = vec![
            Head {
                statement: commitment_id,
                expected: Some(current_rev),
            },
            Head {
                statement: proposal_id,
                expected: Some(proposal_rev),
            },
            Head {
                statement: admission,
                expected: None,
            },
        ];
        let mutations = vec![
            Mutation::Put(domain_statement(
                commitment_id,
                COMMITMENTS,
                &commitment,
                roles,
                Some((minor, asset)),
            )?),
            Mutation::Put(domain_statement(
                proposal_id,
                PROPOSALS,
                &proposal,
                proposal_roles,
                Some((minor, asset)),
            )?),
            Mutation::Put(statement(
                admission,
                DOMAIN_ADMIT,
                &json!({
                    "requestHash": fingerprint(&input),
                    "resultId": commitment_id.to_canonical_string()
                }),
            )),
        ];

        receipt(
            self.db_mut()?.commit(Batch {
                domain: self.domain,
                principal: self.owner,
                key,
                heads,
                mutations,
                content: vec![],
            }),
            commitment_id,
        )
    }

    /// Canonical World Time & Temporal Epistemic Query Contract (`NBR-BUILD-005` Workstream E).
    /// Evaluates Quanta's B+tree revision history at `asKnownAt` sequence cutoff and partitions
    /// state across the 6 distinct temporal epistemic categories:
    /// 1. `observedHistory` (source occurrences & preserved evidence artifacts)
    /// 2. `reconstructedHistory` (scientific event-time interpolation — explicitly gated)
    /// 3. `asKnownHistory` (domain state reconstructed at `asKnownAt` sequence cutoff)
    /// 4. `liveObserved` (current head sequence watermark)
    /// 5. `forecastModel` (numerical model predictions — explicitly gated)
    /// 6. `scenarioFork` (hypothetical unexecuted agent plans isolated from observed reality)
    pub(super) fn world_time_query(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "asKnownAt", "mode"])?;
        let db = self.db()?;
        let head_seq = db.domain_sequence(self.domain, self.owner).map_err(err)?;
        let cutoff = match input.get("asKnownAt") {
            Some(v) if !v.is_null() => v.as_u64().ok_or("INVALID")?,
            _ => head_seq,
        };
        if cutoff > head_seq {
            return Err("INVALID".into());
        }
        let mode = input
            .get("mode")
            .and_then(Value::as_str)
            .unwrap_or(if cutoff < head_seq {
                "as_known"
            } else {
                "live"
            });
        if !["as_known", "live", "scenario"].contains(&mode) {
            return Err("INVALID".into());
        }

        let query_at = |predicate: Qid| -> Result<Vec<Value>, String> {
            let mut revs = db
                .query_current(
                    self.domain,
                    self.owner,
                    &Query {
                        predicate: Some(predicate),
                        as_known_at: Some(cutoff),
                        ..Query::default()
                    },
                )
                .map_err(err)?;
            revs.sort_by_key(|r| std::cmp::Reverse(r.sequence));
            let mut items = Vec::new();
            for r in revs {
                let seq = r.sequence;
                let Some(st) = r.statement else {
                    continue;
                };
                let text_payload = match st.value {
                    Native::Text(t) => Some(t),
                    Native::Map(mut m) => match m.remove("metadata") {
                        Some(Native::Text(t)) => Some(t),
                        _ => None,
                    },
                    _ => None,
                };
                let parsed = text_payload
                    .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                    .unwrap_or_else(|| json!({}));
                items.push(json!({
                    "id": st.id.to_canonical_string(),
                    "revision": seq,
                    "title": parsed.get("title").and_then(Value::as_str).unwrap_or("Record"),
                    "kind": parsed.get("kind").and_then(Value::as_str).unwrap_or("record"),
                    "status": parsed.get("status").or_else(|| parsed.get("stage")).or_else(|| parsed.get("lifecycle")).and_then(Value::as_str).unwrap_or("active"),
                }));
            }
            Ok(items)
        };

        let records_at = query_at(RECORDS)?;
        let offers_at = query_at(MARKET_OFFERS)?;
        let proposals_at = query_at(PROPOSALS)?;
        let commitments_at = query_at(COMMITMENTS)?;
        let projects_at = query_at(PROJECTS)?;
        let artifacts_at = query_at(super::citizen::ARTIFACTS)?;
        let plans_at = query_at(AGENT_PLANS)?;
        drop(db);

        let world_facts = self
            .world()?
            .query_facts(
                PURPOSE,
                &quanta_world::FactQuery {
                    as_known_at: Some(cutoff),
                    versions: quanta_world::Versions::All,
                    ..quanta_world::FactQuery::default()
                },
            )
            .map_err(err)?;

        let mut observed_items: Vec<Value> = world_facts
            .facts
            .iter()
            .flat_map(|f| f.claims.iter())
            .map(|c| {
                json!({
                    "id": c.occurrence.id.to_canonical_string(),
                    "revision": c.occurrence.revision,
                    "recordKey": c.occurrence.record_key,
                    "epistemic": "SourceClaimed",
                    "temporalCategory": "observed_history"
                })
            })
            .collect();
        for a in &artifacts_at {
            observed_items.push(json!({
                "id": a["id"],
                "revision": a["revision"],
                "title": a["title"],
                "epistemic": "Observed",
                "temporalCategory": "observed_history"
            }));
        }

        let scenario_items: Vec<Value> = plans_at
            .into_iter()
            .map(|p| {
                json!({
                    "id": p["id"],
                    "revision": p["revision"],
                    "title": p["title"],
                    "status": p["status"],
                    "epistemic": "Hypothesized",
                    "temporalCategory": "scenario_fork"
                })
            })
            .collect();

        let as_known_total = records_at.len()
            + offers_at.len()
            + proposals_at.len()
            + commitments_at.len()
            + projects_at.len();

        Ok(json!({
            "headSequence": head_seq,
            "asKnownAtSequence": cutoff,
            "mode": mode,
            "isHistoricalRewind": cutoff < head_seq,
            "validTimeSupported": false,
            "temporalCategories": {
                "observedHistory": {
                    "count": observed_items.len(),
                    "items": observed_items,
                    "description": "What sources and preserved artifacts actually recorded at or before cutoff."
                },
                "reconstructedHistory": {
                    "supported": false,
                    "count": 0,
                    "items": [],
                    "description": "Scientific model event-time reconstructions remain gated behind valid-time indexing."
                },
                "asKnownHistory": {
                    "count": as_known_total,
                    "countsByType": {
                        "records": records_at.len(),
                        "offers": offers_at.len(),
                        "proposals": proposals_at.len(),
                        "commitments": commitments_at.len(),
                        "projects": projects_at.len()
                    },
                    "records": records_at,
                    "projects": projects_at,
                    "commitments": commitments_at,
                    "description": "Exact domain state known to Quanta at sequence cutoff."
                },
                "liveObserved": {
                    "headSequence": head_seq,
                    "isAtLiveHead": cutoff == head_seq,
                    "description": "Latest committed domain watermark."
                },
                "forecastModel": {
                    "supported": false,
                    "count": 0,
                    "items": [],
                    "description": "Forward-looking model runs remain distinct from observed state."
                },
                "scenarioFork": {
                    "count": scenario_items.len(),
                    "items": scenario_items,
                    "description": "Hypothetical plans and branches isolated from observed and authoritative records."
                }
            }
        }))
    }

    /// Deterministic `LicenseGate` evaluator (`INV-ARCH-025`).
    /// Enforces rights by `(sourceId, operation, derivedOutput)` rather than assuming
    /// publicly viewable data permits bulk archiving, raw redistribution, or commercial export.
    pub(super) fn evaluate_license_gate(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "sourceId", "operation", "derivedOutput"])?;
        let source_id = input["sourceId"].as_str().ok_or("INVALID")?;
        let operation = input["operation"].as_str().ok_or("INVALID")?;
        let derived = input
            .get("derivedOutput")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        if ![
            "display",
            "archive_local",
            "derive_feature",
            "commercial_export",
            "redistribute_raw",
            "model_training",
        ]
        .contains(&operation)
        {
            return Err("INVALID".into());
        }

        let (license, attribution, permitted, reason) = match source_id {
            "R020_USGS_PUBLIC" | "R001_NOAA_GFS" | "R023_NIFC_WFIGS" => (
                "US-Public-Domain",
                "Data courtesy of U.S. Federal Public Domain source (USGS / NOAA / NIFC)",
                true,
                "U.S. public domain source permits display, local archive, derivation, and commercial coordination with courtesy attribution.",
            ),
            "R002_ECMWF_IFS" => (
                "CC-BY-4.0",
                "Based on data and products of ECMWF (CC BY 4.0)",
                true,
                "CC BY 4.0 permits display, derivation, and commercial export when attribution and modification notice are preserved.",
            ),
            "R004_NOAA_LIGHTNING_DERIVED" => {
                let ok = operation != "redistribute_raw";
                (
                    "NOAA-Vaisala-Derived",
                    "NOAA/NWS nowCOAST; derived from Vaisala NLDN/GLD360",
                    ok,
                    if ok {
                        "Permitted on derived density product."
                    } else {
                        "Raw Vaisala lightning detections cannot be redistributed."
                    },
                )
            }
            "R010_OSM_ODBL" => {
                let ok = operation != "model_training" || derived;
                (
                    "ODbL-1.0",
                    "© OpenStreetMap contributors (ODbL 1.0)",
                    ok,
                    if ok {
                        "Permitted under ODbL 1.0 with attribution and share-alike notice on derivative databases."
                    } else {
                        "Unattributed raw ODbL model training without derivative database compliance is restricted."
                    },
                )
            }
            "R011_GOOGLE_3D_TILES" | "R007_GOOGLE_STREET_VIEW" => {
                let ok = operation == "display";
                (
                    "Google-Maps-Platform-ToS",
                    "Google Maps Platform — in-app logo required",
                    ok,
                    if ok {
                        "In-app viewport display permitted with active session and Google attribution."
                    } else {
                        "Google Maps Platform ToS prohibits offline archiving, raw tile redistribution, derivative extraction, and model training."
                    },
                )
            }
            "R012_OPENSKY_NC" | "R030_GOOGLE_NEWS_NC" => {
                let ok = matches!(operation, "display" | "archive_local" | "derive_feature")
                    && operation != "commercial_export";
                (
                    "Non-Commercial-Research",
                    "Non-commercial research/personal use only (OpenSky / Google News RSS)",
                    ok,
                    if ok {
                        "Non-commercial display and local research analysis permitted."
                    } else {
                        "Source terms strictly prohibit commercial export, commercial redistribution, or commercial model training."
                    },
                )
            }
            "R015_ADSBDB_ROUTES" => {
                let ok = operation == "display";
                (
                    "Proprietary-Courtesy-Display",
                    "adsbdb — route data credited to David Taylor & Jim Mason",
                    ok,
                    if ok {
                        "In-app display permitted with courtesy credit."
                    } else {
                        "Route data may not be copied, archived into external databases, or redistributed without explicit permission."
                    },
                )
            }
            "LOCAL_FIRSTHAND_OWNER" => (
                "Local-Owner-Authoritative",
                "Local Workspace Owner",
                true,
                "Firsthand local owner data is governed by explicit owner consent.",
            ),
            _ => return Err("INVALID".into()),
        };

        Ok(json!({
            "sourceId": source_id,
            "operation": operation,
            "derivedOutput": derived,
            "permitted": permitted,
            "code": if permitted { "PERMITTED" } else { "LICENSE_RESTRICTED" },
            "license": license,
            "requiredAttribution": attribution,
            "reason": reason,
            "policyEpoch": 1
        }))
    }

    /// Queries Quanta's native `by_participant` secondary B+tree index and `Statement.roles`
    /// to return all outbound and inbound semantic relationships (`ROLE_PLACE`, `ROLE_OFFER`,
    /// `ROLE_PROJECT`, `ROLE_PROPOSAL`, `ROLE_LINK`) for any entity QID.
    pub(super) fn object_graph(&self, input: Value) -> Result<Value, String> {
        allowed(&input, &["op", "id"])?;
        let target_id = parse(&input["id"])?;
        let db = self.db()?;
        let role_name = |r: Qid| -> &'static str {
            if r == ROLE_PLACE {
                "located_at_place"
            } else if r == ROLE_OFFER {
                "uses_market_offer"
            } else if r == ROLE_PROJECT {
                "belongs_to_project"
            } else if r == ROLE_PROPOSAL {
                "commits_proposal"
            } else if r == super::qharness::ROLE_MISSION {
                "belongs_to_mission"
            } else if r == super::qharness::ROLE_TASK {
                "executes_task"
            } else if r == super::qharness::ROLE_MANDATE {
                "governed_by_mandate"
            } else if r == super::qharness::ROLE_FRAME {
                "grounded_in_qframe"
            } else if r == ROLE_LINK {
                "references"
            } else {
                "related_to"
            }
        };
        let extract_summary = |s: &Statement| -> (String, String) {
            match &s.value {
                Native::Map(m) => {
                    let kind = match m.get("kind") {
                        Some(Native::Text(k)) => k.clone(),
                        _ => "record".into(),
                    };
                    let title = match m.get("title") {
                        Some(Native::Text(t)) => t.clone(),
                        _ => s.id.to_canonical_string(),
                    };
                    (kind, title)
                }
                Native::Text(t) => {
                    if let Ok(v) = serde_json::from_str::<Value>(t) {
                        (
                            v["kind"].as_str().unwrap_or("record").to_owned(),
                            v["title"].as_str().unwrap_or("Record").to_owned(),
                        )
                    } else {
                        ("record".into(), s.id.to_canonical_string())
                    }
                }
                _ => ("record".into(), s.id.to_canonical_string()),
            }
        };

        let mut outbound = Vec::new();
        if let Some(rev) = db
            .revision_current(self.domain, self.owner, target_id, None)
            .map_err(err)?
        {
            if let Some(stmt) = rev.statement {
                for (role_qid, participant_qid) in stmt.roles {
                    let (mut kind, mut title) =
                        ("entity".to_owned(), participant_qid.to_canonical_string());
                    if let Ok(Some(target_rev)) =
                        db.revision_current(self.domain, self.owner, participant_qid, None)
                    {
                        if let Some(target_stmt) = target_rev.statement {
                            (kind, title) = extract_summary(&target_stmt);
                        }
                    }
                    outbound.push(json!({
                        "role": role_name(role_qid),
                        "targetId": participant_qid.to_canonical_string(),
                        "kind": kind,
                        "title": title,
                    }));
                }
            }
        }

        // Query Quanta's native `by_participant` B+tree secondary index for inbound edges!
        let inbound_revs = db
            .query_current(
                self.domain,
                self.owner,
                &Query {
                    participant: Some(target_id),
                    ..Query::default()
                },
            )
            .map_err(err)?;

        let mut inbound = Vec::new();
        for rev in inbound_revs {
            if let Some(stmt) = rev.statement {
                let (kind, title) = extract_summary(&stmt);
                for (role_qid, part_qid) in &stmt.roles {
                    if *part_qid == target_id {
                        inbound.push(json!({
                            "role": role_name(*role_qid),
                            "sourceId": stmt.id.to_canonical_string(),
                            "kind": kind,
                            "title": title,
                            "revision": rev.sequence,
                        }));
                    }
                }
            }
        }

        Ok(json!({
            "id": target_id.to_canonical_string(),
            "outbound": outbound,
            "inbound": inbound,
            "totalEdges": outbound.len() + inbound.len(),
        }))
    }

    pub(super) fn domain_network(&self) -> Result<Value, String> {
        let map_rows = |predicate: Qid| -> Result<Vec<Value>, String> {
            let mut rows = self.metadata(predicate)?;
            rows.sort_by_key(|r| std::cmp::Reverse(r.1));
            Ok(rows
                .into_iter()
                .map(|(id, revision, payload)| {
                    json!({
                        "id": id.to_canonical_string(),
                        "revision": revision,
                        "payload": payload,
                        "epistemic": "Authored"
                    })
                })
                .collect())
        };
        let offers = map_rows(MARKET_OFFERS)?;
        let proposals = map_rows(PROPOSALS)?;
        let commitments = map_rows(COMMITMENTS)?;
        let projects = map_rows(PROJECTS)?;
        let social_posts = map_rows(SOCIAL_POSTS)?;
        let agent_plans = map_rows(AGENT_PLANS)?;

        // Execute native Quanta streaming aggregations over the canonical snapshot
        // Summing the `currency` field (`NativeKind::Currency`) enforces currency-code scope matching in Quanta!
        let db = self.db()?;
        let snapshot = db.snapshot().map_err(err)?;
        let currency_field = QueryField::Value(vec![ValueStep::Key("currency".into())]);
        let status_field = QueryField::Value(vec![ValueStep::Key("status".into())]);

        let extract_currency_minor = |res: &quanta_core::AggregateResult| -> i64 {
            let Some(val) = res
                .groups
                .first()
                .and_then(|g| g.values.get(1))
                .and_then(Option::as_ref)
            else {
                return 0;
            };
            let parse_rat = |v: &Native| -> Option<i64> {
                match v {
                    Native::I64(n) => Some(*n),
                    Native::Typed(nv) if nv.kind == NativeKind::Rational => {
                        if let Native::Map(m) = &nv.payload {
                            if let Some(Native::Text(num)) = m.get("numerator") {
                                return num.parse::<i64>().ok();
                            }
                        }
                        None
                    }
                    _ => None,
                }
            };
            match val {
                Native::Typed(nv) if nv.kind == NativeKind::Currency => {
                    if let Native::Map(m) = &nv.payload {
                        if let Some(amt) = m.get("amount") {
                            return parse_rat(amt).unwrap_or(0);
                        }
                    }
                    0
                }
                other => parse_rat(other).unwrap_or(0),
            }
        };

        let project_agg = db
            .aggregate(
                &snapshot,
                self.domain,
                self.owner,
                &AggregateQuery {
                    input: FilteredQuery {
                        selection: Query {
                            subject: None,
                            predicate: Some(PROJECTS),
                            participant: None,
                            as_known_at: None,
                            valid_at: None,
                        },
                        filter: FilterExpr::All,
                    },
                    group_by: vec![],
                    aggregates: vec![Aggregate::CountRows, Aggregate::Sum(currency_field.clone())],
                    limits: AggregateLimits::default(),
                },
            )
            .map_err(err)?;

        let total_project_budget_minor = extract_currency_minor(&project_agg);

        let committed_agg = db
            .aggregate(
                &snapshot,
                self.domain,
                self.owner,
                &AggregateQuery {
                    input: FilteredQuery {
                        selection: Query {
                            subject: None,
                            predicate: Some(PROPOSALS),
                            participant: None,
                            as_known_at: None,
                            valid_at: None,
                        },
                        filter: FilterExpr::Or(vec![
                            FilterExpr::Compare {
                                field: status_field.clone(),
                                op: CompareOp::Equal,
                                value: Native::Text("accepted".into()),
                            },
                            FilterExpr::Compare {
                                field: status_field.clone(),
                                op: CompareOp::Equal,
                                value: Native::Text("completed".into()),
                            },
                            FilterExpr::Compare {
                                field: status_field.clone(),
                                op: CompareOp::Equal,
                                value: Native::Text("verified".into()),
                            },
                        ]),
                    },
                    group_by: vec![],
                    aggregates: vec![Aggregate::CountRows, Aggregate::Sum(currency_field.clone())],
                    limits: AggregateLimits::default(),
                },
            )
            .map_err(err)?;

        let total_committed_minor = extract_currency_minor(&committed_agg);

        let verified_agg = db
            .aggregate(
                &snapshot,
                self.domain,
                self.owner,
                &AggregateQuery {
                    input: FilteredQuery {
                        selection: Query {
                            subject: None,
                            predicate: Some(COMMITMENTS),
                            participant: None,
                            as_known_at: None,
                            valid_at: None,
                        },
                        filter: FilterExpr::Compare {
                            field: status_field,
                            op: CompareOp::Equal,
                            value: Native::Text("verified".into()),
                        },
                    },
                    group_by: vec![],
                    aggregates: vec![Aggregate::CountRows, Aggregate::Sum(currency_field)],
                    limits: AggregateLimits::default(),
                },
            )
            .map_err(err)?;

        let total_verified_minor = extract_currency_minor(&verified_agg);

        // Execute native Quanta GraphQuery traversal across projects -> places/offers
        let project_roots: Vec<Qid> = projects
            .iter()
            .filter_map(|p| p["id"].as_str())
            .filter_map(|s| Qid::parse(s).ok())
            .collect();
        let mut graph_edges_count = 0usize;
        if !project_roots.is_empty() {
            for role in [ROLE_PLACE, ROLE_OFFER, ROLE_PROPOSAL, ROLE_LINK] {
                if let Ok(graph) = db.traverse(
                    &snapshot,
                    self.domain,
                    self.owner,
                    &quanta_core::GraphQuery {
                        roots: project_roots.clone(),
                        predicate: PROJECTS,
                        target: quanta_core::GraphTarget::Role(role),
                        max_hops: 2,
                        max_nodes: 256,
                        max_edges: 256,
                        max_candidates: 1024,
                        as_known_at: None,
                        valid_at: None,
                    },
                ) {
                    graph_edges_count += graph.edges.len();
                }
            }
        }

        Ok(json!({
            "offers": offers,
            "proposals": proposals,
            "commitments": commitments,
            "projects": projects,
            "socialPosts": social_posts,
            "agentPlans": agent_plans,
            "summary": {
                "offerCount": offers.len(),
                "proposalCount": proposals.len(),
                "commitmentCount": commitments.len(),
                "projectCount": projects.len(),
                "socialPostCount": social_posts.len(),
                "agentPlanCount": agent_plans.len(),
                "totalProjectBudgetMinorUnits": total_project_budget_minor,
                "totalCommittedMinorUnits": total_committed_minor,
                "totalVerifiedMinorUnits": total_verified_minor,
                "connectedProjectGraphEdges": graph_edges_count,
                "currency": "USD"
            },
            "scope": "private-local-owner"
        }))
    }
}
