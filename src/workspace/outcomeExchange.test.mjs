import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTCOME_STATES,
  createOutcomeContract,
  proposeSolution,
  fundEscrow,
  startExecution,
  submitEvidence,
  verifyAndRelease,
  disputeOutcome,
  resolveDispute,
} from './outcomeExchange.js';

test('OutcomeContract 5-stage lifecycle executes cleanly with exact minor units and evidence hashing', () => {
  // Stage 1: Need (Draft)
  const contract = createOutcomeContract({
    id: 'out-101',
    title: 'Replace High-Pressure Fuel Pump',
    needDescription: 'Install OEM upgraded HPFP on Golf R and log rail pressure.',
    buyerId: 'user-greyson',
    currency: 'USD',
    tags: ['automotive', 'tuning', 'mechanical'],
  });

  assert.equal(contract.state, OUTCOME_STATES.DRAFT);
  assert.equal(contract.need.buyerId, 'user-greyson');
  assert.equal(contract.escrow.fundedAmountMinor, 0);

  // Stage 2: Solution & WorkPackage (Proposed)
  proposeSolution(contract, {
    providerId: 'shop-lucky-sevin',
    solutionDescription: 'Install Autotech HPFP kit and conduct 3rd gear pull datalog verification.',
    deliverables: ['Physical HPFP Install', 'CSV Datalog Review', 'Leak Test'],
    acceptanceCriteria: ['Rail pressure >= 130 bar at 6500 RPM', 'Zero DTC fault codes'],
    priceMinorUnits: 45000, // $450.00
    estimatedDays: 2,
  });

  assert.equal(contract.state, OUTCOME_STATES.PROPOSED);
  assert.equal(contract.escrow.targetAmountMinor, 45000);
  assert.equal(contract.solution.providerId, 'shop-lucky-sevin');

  // Stage 3: Agreement & Escrow Funding (Funded)
  fundEscrow(contract, {
    funderId: 'user-greyson',
    amountMinorUnits: 45000,
    fundingReference: 'ach-tx-998822',
  });

  assert.equal(contract.state, OUTCOME_STATES.FUNDED_ESCROW);
  assert.equal(contract.escrow.funded, true);
  assert.equal(contract.escrow.fundedAmountMinor, 45000);

  // Stage 4: Work Execution (In Progress)
  startExecution(contract, {
    actorId: 'shop-lucky-sevin',
  });

  assert.equal(contract.state, OUTCOME_STATES.IN_PROGRESS);

  // Stage 5a: Evidence Submission
  submitEvidence(contract, {
    providerId: 'shop-lucky-sevin',
    evidenceHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    evidenceUri: 'file:///evidence/hpfp_dyno_log.csv',
    artifacts: ['datalog_run_01.csv', 'engine_bay_post_install.jpg'],
    notes: 'HPFP installed and validated. Rail pressure held steady at 138 bar under full boost.',
  });

  assert.equal(contract.state, OUTCOME_STATES.EVIDENCE_SUBMITTED);
  assert.equal(contract.evidence.artifacts.length, 2);

  // Stage 5b: Verification & Escrow Payout (Verified Complete)
  verifyAndRelease(contract, {
    verifierId: 'user-greyson',
    notes: 'Datalog verified: rail pressure meets spec with zero fuel pressure drops.',
  });

  assert.equal(contract.state, OUTCOME_STATES.VERIFIED_COMPLETE);
  assert.equal(contract.escrow.releasedToProviderMinor, 45000);
  assert.equal(contract.escrow.refundedToBuyerMinor, 0);

  // Audit timeline verification
  assert.equal(contract.timeline.length, 6);
  assert.equal(contract.timeline[0].state, OUTCOME_STATES.DRAFT);
  assert.equal(contract.timeline[5].state, OUTCOME_STATES.VERIFIED_COMPLETE);
});

test('OutcomeContract enforces strict state transitions and input validation', () => {
  const contract = createOutcomeContract({
    title: 'Code Audit',
    buyerId: 'user-alice',
  });

  // Cannot fund before solution is proposed
  assert.throws(
    () => fundEscrow(contract, { funderId: 'user-alice', amountMinorUnits: 1000 }),
    /contract must be proposed/,
  );

  // Price must be an integer > 0
  assert.throws(
    () => proposeSolution(contract, { providerId: 'dev-bob', priceMinorUnits: -50 }),
    /Price must be a positive integer/,
  );
  assert.throws(
    () => proposeSolution(contract, { providerId: 'dev-bob', priceMinorUnits: 10.5 }),
    /Price must be a positive integer/,
  );

  proposeSolution(contract, {
    providerId: 'dev-bob',
    priceMinorUnits: 10000,
  });

  // Non-buyer cannot fund escrow
  assert.throws(
    () => fundEscrow(contract, { funderId: 'user-charlie', amountMinorUnits: 10000 }),
    /Only the designated contract buyer can fund escrow/,
  );

  // Mismatched amount rejected
  assert.throws(
    () => fundEscrow(contract, { funderId: 'user-alice', amountMinorUnits: 9999 }),
    /Escrow funding mismatch/,
  );
});

test('OutcomeContract dispute adjudication handles partial split and full refunds', () => {
  // Case A: Partial Split
  const contract = createOutcomeContract({
    title: 'ECU Map Calibration',
    buyerId: 'user-greyson',
  });
  proposeSolution(contract, {
    providerId: 'tuner-dave',
    priceMinorUnits: 60000, // $600.00
  });
  fundEscrow(contract, {
    funderId: 'user-greyson',
    amountMinorUnits: 60000,
  });
  startExecution(contract, { actorId: 'tuner-dave' });
  submitEvidence(contract, {
    providerId: 'tuner-dave',
    evidenceHash: '11223344556677889900aabbccddeeff',
  });

  // Dispute opened
  disputeOutcome(contract, {
    disputerId: 'user-greyson',
    reason: 'Map caused severe timing pull on cylinder 3.',
  });
  assert.equal(contract.state, OUTCOME_STATES.DISPUTED);

  // Dispute resolution sum mismatch check
  assert.throws(
    () =>
      resolveDispute(contract, {
        adjudicatorId: 'mediator-system',
        buyerRefundMinor: 40000,
        providerPayoutMinor: 10000, // 50000 != 60000
      }),
    /Dispute settlement sum \(50000\) must exactly equal funded escrow \(60000\)/,
  );

  // Adjudicate 50/50 split
  resolveDispute(contract, {
    adjudicatorId: 'mediator-system',
    buyerRefundMinor: 30000,
    providerPayoutMinor: 30000,
    notes: 'Half refund for diagnostics; tuner compensated for bench time.',
  });

  assert.equal(contract.state, OUTCOME_STATES.SETTLED);
  assert.equal(contract.escrow.refundedToBuyerMinor, 30000);
  assert.equal(contract.escrow.releasedToProviderMinor, 30000);

  // Case B: Full Refund
  const contractB = createOutcomeContract({
    title: 'Dyno Session',
    buyerId: 'user-greyson',
  });
  proposeSolution(contractB, {
    providerId: 'dyno-shop',
    priceMinorUnits: 25000,
  });
  fundEscrow(contractB, {
    funderId: 'user-greyson',
    amountMinorUnits: 25000,
  });
  startExecution(contractB, { actorId: 'dyno-shop' });
  disputeOutcome(contractB, {
    disputerId: 'user-greyson',
    reason: 'Dyno broke down before session started.',
  });

  resolveDispute(contractB, {
    adjudicatorId: 'mediator-system',
    buyerRefundMinor: 25000,
    providerPayoutMinor: 0,
    notes: 'Equipment failure; 100% refund.',
  });

  assert.equal(contractB.state, OUTCOME_STATES.REFUNDED);
  assert.equal(contractB.escrow.refundedToBuyerMinor, 25000);
  assert.equal(contractB.escrow.releasedToProviderMinor, 0);
});
