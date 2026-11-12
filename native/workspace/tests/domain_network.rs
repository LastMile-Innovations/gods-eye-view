use neighbor_workspace::Workspace;
use serde_json::json;

const K1: &str = "11111111111111111111111111111111";
const K2: &str = "22222222222222222222222222222222";
const K3: &str = "33333333333333333333333333333333";
const K4: &str = "44444444444444444444444444444444";
const K5: &str = "55555555555555555555555555555555";
const K6: &str = "66666666666666666666666666666666";

#[test]
fn starter_catalog_exact_money_and_streaming_aggregates_work_end_to_end() {
    let temp = tempfile::tempdir().unwrap();
    let store = Workspace::open(temp.path()).unwrap();

    // 1. Seed starter catalog idempotently
    let seed_cmd = json!({"op": "seedStarterCatalog", "key": K1});
    let first_seed = store.execute(seed_cmd.clone()).unwrap();
    assert_eq!(first_seed["status"], "committed");
    assert_eq!(store.execute(seed_cmd).unwrap(), first_seed);

    let net = store.execute(json!({"op": "domainNetwork"})).unwrap();
    assert_eq!(net["summary"]["offerCount"], 4);
    assert_eq!(net["summary"]["socialPostCount"], 1);

    // 2. Reject floating-point currency amounts (INV-MKT-005)
    let float_offer = json!({
        "op": "saveMarketOffer",
        "key": K2,
        "payload": {
            "title": "Bad Float Offer",
            "category": "materials",
            "providerName": "Tester",
            "description": "Should reject float",
            "price": { "amountMinorUnits": 19.99, "currency": "USD" },
            "rateBasis": "fixed",
            "status": "available"
        }
    });
    assert_eq!(store.execute(float_offer).unwrap_err(), "INVALID");

    // 3. Create an accepted Proposal and verify native Quanta streaming aggregate
    let offer_id = net["offers"][0]["id"].as_str().unwrap().to_owned();
    let prop_cmd = json!({
        "op": "saveProposal",
        "key": K2,
        "payload": {
            "title": "Timber Frame Delivery & Millwork",
            "offerId": offer_id,
            "counterparty": "Redwood Cooperative Mill",
            "scope": "Deliver 8x8 posts and hardware to North Berkeley Commons",
            "deliverables": [
                { "title": "8x8 redwood posts", "amountMinorUnits": 115000 },
                { "title": "Simpson structural brackets", "amountMinorUnits": 30000 }
            ],
            "totalPrice": { "amountMinorUnits": 145000, "currency": "USD" },
            "status": "accepted"
        }
    });
    let prop_res = store.execute(prop_cmd).unwrap();
    assert_eq!(prop_res["status"], "committed");

    let net_after_prop = store.execute(json!({"op": "domainNetwork"})).unwrap();
    assert_eq!(net_after_prop["summary"]["proposalCount"], 1);
    assert_eq!(
        net_after_prop["summary"]["totalCommittedMinorUnits"],
        145000
    );
}

#[test]
fn agent_intent_to_plan_enforces_four_consent_gates_and_commits_project_atomically() {
    let temp = tempfile::tempdir().unwrap();
    let store = Workspace::open(temp.path()).unwrap();

    store
        .execute(json!({"op": "seedStarterCatalog", "key": K1}))
        .unwrap();

    // 1. Compile an AI Agent plan from natural language
    let compile_cmd = json!({
        "op": "compileAgentPlan",
        "key": K3,
        "payload": {
            "prompt": "Build a backyard timber workshop and perimeter fence with solar subpanel in Berkeley",
            "currency": "USD"
        }
    });
    let plan_receipt = store.execute(compile_cmd).unwrap();
    let plan_id = plan_receipt["id"].as_str().unwrap().to_owned();

    let net = store.execute(json!({"op": "domainNetwork"})).unwrap();
    assert_eq!(net["summary"]["agentPlanCount"], 1);
    let plan = &net["agentPlans"][0];
    assert_eq!(plan["id"], plan_id);
    assert_eq!(plan["payload"]["status"], "draft");
    let expected_tasks = plan["payload"]["proposedProject"]["milestones"]
        .as_array()
        .unwrap()
        .len();
    assert!(expected_tasks > 0);

    // 2. Attempting to execute with an unapproved gate must fail with PERMISSION_DENIED
    let unapproved_exec = json!({
        "op": "executeAgentPlan",
        "key": K4,
        "planId": plan_id,
        "expected": plan["revision"],
        "whatIHeardConfirmed": true,
        "financialGateApproved": false
    });
    assert_eq!(
        store.execute(unapproved_exec).unwrap_err(),
        "PERMISSION_DENIED"
    );

    // 3. Approving consent gates atomically creates the Project + Milestone Tasks
    let approved_exec = json!({
        "op": "executeAgentPlan",
        "key": K5,
        "planId": plan_id,
        "expected": plan["revision"],
        "whatIHeardConfirmed": true,
        "financialGateApproved": true
    });
    let exec_receipt = store.execute(approved_exec).unwrap();
    assert_eq!(exec_receipt["status"], "committed");

    let net_after = store.execute(json!({"op": "domainNetwork"})).unwrap();
    assert_eq!(net_after["summary"]["projectCount"], 1);
    assert!(
        net_after["summary"]["totalProjectBudgetMinorUnits"]
            .as_i64()
            .unwrap()
            > 0
    );
    assert_eq!(net_after["agentPlans"][0]["payload"]["status"], "executed");

    // Verify milestone tasks were created in the canonical workspace snapshot
    let snap = store.execute(json!({"op": "snapshot"})).unwrap();
    let task_count = snap["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|i| i["payload"]["kind"] == "task")
        .count();
    assert_eq!(task_count, expected_tasks);

    // 4. Verify Social post can share the newly created Project card
    let project_id = exec_receipt["id"].as_str().unwrap();
    let social_cmd = json!({
        "op": "saveSocialPost",
        "key": K6,
        "payload": {
            "channel": "projects",
            "author": "Neighborhood Builder",
            "title": "Kicking off the Backyard Workshop build!",
            "body": "Looking for neighbors to join the foundation pour milestone.",
            "sharedObjectId": project_id,
            "sharedObjectKind": "project"
        }
    });
    assert_eq!(store.execute(social_cmd).unwrap()["status"], "committed");

    // 5. Verify native Quanta Role Graph (inbound tasks + social post, outbound place + offers + plan)
    let graph = store
        .execute(json!({"op": "objectGraph", "id": project_id}))
        .unwrap();
    assert!(!graph["outbound"].as_array().unwrap().is_empty());
    assert!(
        graph["inbound"].as_array().unwrap().len() > expected_tasks,
        "Expected inbound edges from milestone tasks, agent plan, and social post"
    );
    assert!(
        net_after["summary"]["connectedProjectGraphEdges"]
            .as_u64()
            .unwrap()
            > 0
    );
}

#[test]
fn commitment_outcome_verification_world_time_and_license_gate_work_end_to_end() {
    let temp = tempfile::tempdir().unwrap();
    let store = Workspace::open(temp.path()).unwrap();

    // 1. Seed starter catalog and capture initial World Time sequence
    let seed = store
        .execute(json!({"op": "seedStarterCatalog", "key": K1}))
        .unwrap();
    let seq_after_seed = seed["sequence"].as_u64().unwrap();

    let net = store.execute(json!({"op": "domainNetwork"})).unwrap();
    let offer_id = net["offers"][0]["id"].as_str().unwrap().to_owned();
    let offer_rev = net["offers"][0]["revision"].as_u64().unwrap();

    // 2. Create a proposed Proposal
    let prop_res = store
        .execute(json!({
            "op": "saveProposal",
            "key": K2,
            "payload": {
                "title": "Perimeter Fence Post Replacement",
                "offerId": offer_id,
                "counterparty": "East Bay Carpentry Guild",
                "scope": "Replace 4 rotted corner posts with heartwood redwood",
                "deliverables": [
                    { "title": "Excavate & set 4 corner posts", "amountMinorUnits": 85000 }
                ],
                "totalPrice": { "amountMinorUnits": 85000, "currency": "USD" },
                "status": "proposed"
            }
        }))
        .unwrap();
    let prop_id = prop_res["id"].as_str().unwrap().to_owned();
    let prop_rev = prop_res["sequence"].as_u64().unwrap();

    // 3. Stale offer revision on saveCommitment must abort with CONFLICT
    let stale_commit = store.execute(json!({
        "op": "saveCommitment",
        "key": K3,
        "proposalId": prop_id,
        "expectedProposalRevision": prop_rev,
        "expectedOfferRevision": offer_rev + 99,
        "termsAccepted": true,
        "scopeNote": "Should fail due to stale offer revision"
    }));
    assert_eq!(stale_commit.unwrap_err(), "CONFLICT");

    // 4. Valid saveCommitment atomically mints Commitment + Effect Receipt and updates Proposal to accepted
    let commit_res = store
        .execute(json!({
            "op": "saveCommitment",
            "key": K3,
            "proposalId": prop_id,
            "expectedProposalRevision": prop_rev,
            "expectedOfferRevision": offer_rev,
            "termsAccepted": true,
            "scopeNote": "Approved exact terms for corner post replacement"
        }))
        .unwrap();
    let commitment_id = commit_res["id"].as_str().unwrap().to_owned();
    let commitment_rev = commit_res["sequence"].as_u64().unwrap();

    // 5. verifyCommitmentOutcome: `verified_complete` WITHOUT evidence must fail with INVALID
    let unverified_attempt = store.execute(json!({
        "op": "verifyCommitmentOutcome",
        "key": K4,
        "commitmentId": commitment_id,
        "expectedRevision": commitment_rev,
        "outcomeState": "verified_complete",
        "evidenceIds": [],
        "verificationNote": "Claiming verified without evidence must be rejected"
    }));
    assert_eq!(unverified_attempt.unwrap_err(), "INVALID");

    // 6. Preserve a real Citizen Evidence artifact and use its QID to verify the Commitment outcome
    let ev_res = store
        .execute(json!({
            "op": "preserveEvidence",
            "key": K4,
            "permissionConfirmed": true,
            "bytes": [137, 80, 78, 71, 13, 10, 26, 10],
            "payload": {
                "title": "Plumb & concrete footing inspection photo",
                "fileName": "footing-inspection.png",
                "mediaType": "image/png",
                "family": "04",
                "sourceType": "firsthand",
                "originGroup": "owner-inspection",
                "dependsOn": null,
                "notes": "Corner posts verified plumb at 36-inch depth",
                "assertedCapturedAt": "2026-10-17T15:00:00Z",
                "coordinates": [-122.273, 37.8715]
            }
        }))
        .unwrap();
    let evidence_id = ev_res["id"].as_str().unwrap().to_owned();

    let verify_res = store
        .execute(json!({
            "op": "verifyCommitmentOutcome",
            "key": K5,
            "commitmentId": commitment_id,
            "expectedRevision": commitment_rev,
            "outcomeState": "verified_complete",
            "evidenceIds": [evidence_id],
            "verificationNote": "Verified plumb and cured with firsthand inspection artifact"
        }))
        .unwrap();
    assert_eq!(verify_res["status"], "committed");

    let net_verified = store.execute(json!({"op": "domainNetwork"})).unwrap();
    assert_eq!(net_verified["summary"]["commitmentCount"], 1);
    assert_eq!(net_verified["summary"]["totalCommittedMinorUnits"], 85000);
    assert_eq!(net_verified["summary"]["totalVerifiedMinorUnits"], 85000);
    assert_eq!(
        net_verified["commitments"][0]["payload"]["outcomeState"],
        "verified_complete"
    );

    // 7. Verify World Time Query (`asKnownAt` historical rewind vs `live`)
    let rewind = store
        .execute(json!({
            "op": "worldTimeQuery",
            "asKnownAt": seq_after_seed,
            "mode": "as_known"
        }))
        .unwrap();
    assert_eq!(rewind["isHistoricalRewind"], true);
    assert_eq!(rewind["validTimeSupported"], false);
    assert_eq!(
        rewind["temporalCategories"]["asKnownHistory"]["countsByType"]["offers"],
        4
    );
    assert_eq!(
        rewind["temporalCategories"]["asKnownHistory"]["countsByType"]["commitments"], 0,
        "At seq_after_seed, the commitment did not exist yet!"
    );

    let live_time = store
        .execute(json!({
            "op": "worldTimeQuery",
            "mode": "live"
        }))
        .unwrap();
    assert_eq!(live_time["isHistoricalRewind"], false);
    assert_eq!(
        live_time["temporalCategories"]["asKnownHistory"]["countsByType"]["commitments"],
        1
    );
    assert_eq!(
        live_time["temporalCategories"]["observedHistory"]["count"],
        1
    );

    // 8. Verify deterministic LicenseGate by (sourceId, operation, derivedOutput)
    let usgs_export = store
        .execute(json!({
            "op": "evaluateLicenseGate",
            "sourceId": "R020_USGS_PUBLIC",
            "operation": "commercial_export",
            "derivedOutput": true
        }))
        .unwrap();
    assert_eq!(usgs_export["permitted"], true);
    assert_eq!(usgs_export["code"], "PERMITTED");

    let opensky_export = store
        .execute(json!({
            "op": "evaluateLicenseGate",
            "sourceId": "R012_OPENSKY_NC",
            "operation": "commercial_export",
            "derivedOutput": true
        }))
        .unwrap();
    assert_eq!(opensky_export["permitted"], false);
    assert_eq!(opensky_export["code"], "LICENSE_RESTRICTED");

    let gtiles_archive = store
        .execute(json!({
            "op": "evaluateLicenseGate",
            "sourceId": "R011_GOOGLE_3D_TILES",
            "operation": "archive_local",
            "derivedOutput": false
        }))
        .unwrap();
    assert_eq!(gtiles_archive["permitted"], false);
    assert_eq!(gtiles_archive["code"], "LICENSE_RESTRICTED");
}
