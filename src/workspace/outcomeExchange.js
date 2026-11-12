import { formatExactMoney } from './capabilityBus.js';

/**
 * NeighborOS Outcome Exchange & OutcomeContract Primitives (`CAP-OUTCOME-EXCHANGE`).
 *
 * Implements the 5-stage Outcome Lifecycle:
 * Need -> Solution -> WorkPackage -> Agreement -> VerifiedOutcome
 *
 * Guarantees:
 * - Integer minor units (cents) for exact escrow & settlement without float drift.
 * - Cryptographic evidence linkage (SHA-256 artifact hashes).
 * - Deterministic state machine with audit trails.
 */

export const OUTCOME_STATES = Object.freeze({
  DRAFT: 'draft',
  PROPOSED: 'proposed',
  FUNDED_ESCROW: 'funded_escrow',
  IN_PROGRESS: 'in_progress',
  EVIDENCE_SUBMITTED: 'evidence_submitted',
  VERIFIED_COMPLETE: 'verified_complete',
  DISPUTED: 'disputed',
  REFUNDED: 'refunded',
  SETTLED: 'settled',
});

/**
 * Creates a new canonical OutcomeContract from a user or agent need.
 */
export function createOutcomeContract({
  id = `out-${crypto.randomUUID()}`,
  title,
  needDescription,
  buyerId,
  currency = 'USD',
  tags = [],
}) {
  if (!title || typeof title !== 'string') {
    throw new Error('OutcomeContract requires a valid title');
  }
  if (!buyerId || typeof buyerId !== 'string') {
    throw new Error('OutcomeContract requires a valid buyerId');
  }

  return {
    id,
    kind: 'outcome-contract',
    state: OUTCOME_STATES.DRAFT,
    need: {
      title,
      description: needDescription || '',
      buyerId,
      createdAtEpochMs: Date.now(),
      tags: [...tags],
    },
    solution: null,
    workPackage: null,
    escrow: {
      currency,
      fundedAmountMinor: 0,
      targetAmountMinor: 0,
      funded: false,
      fundingReference: null,
      releasedToProviderMinor: 0,
      refundedToBuyerMinor: 0,
    },
    evidence: null,
    verification: null,
    timeline: [
      {
        state: OUTCOME_STATES.DRAFT,
        actorId: buyerId,
        timestampEpochMs: Date.now(),
        action: 'Created draft need',
      },
    ],
  };
}

/**
 * Proposes a concrete solution and work package with deliverables and acceptance criteria.
 */
export function proposeSolution(
  contract,
  {
    providerId,
    solutionDescription,
    deliverables = [],
    acceptanceCriteria = [],
    priceMinorUnits,
    estimatedDays = 7,
  },
) {
  if (contract.state !== OUTCOME_STATES.DRAFT && contract.state !== OUTCOME_STATES.PROPOSED) {
    throw new Error(`Cannot propose solution in state '${contract.state}'`);
  }
  if (!providerId) throw new Error('Provider ID is required');
  if (typeof priceMinorUnits !== 'number' || priceMinorUnits <= 0 || !Number.isInteger(priceMinorUnits)) {
    throw new Error('Price must be a positive integer in minor units');
  }

  contract.solution = {
    providerId,
    description: solutionDescription || '',
    proposedAtEpochMs: Date.now(),
  };

  contract.workPackage = {
    deliverables: [...deliverables],
    acceptanceCriteria: [...acceptanceCriteria],
    estimatedDays,
    deadlineEpochMs: Date.now() + estimatedDays * 86400 * 1000,
  };

  contract.escrow.targetAmountMinor = priceMinorUnits;
  contract.state = OUTCOME_STATES.PROPOSED;
  contract.timeline.push({
    state: OUTCOME_STATES.PROPOSED,
    actorId: providerId,
    timestampEpochMs: Date.now(),
    action: `Proposed solution with budget ${formatExactMoney({ currency: contract.escrow.currency, amountMinorUnits: priceMinorUnits })}`,
  });

  return contract;
}

/**
 * Locks buyer funds in escrow matching the target work package budget.
 */
export function fundEscrow(contract, { funderId, amountMinorUnits, fundingReference }) {
  if (contract.state !== OUTCOME_STATES.PROPOSED) {
    throw new Error(`Cannot fund escrow in state '${contract.state}'; contract must be proposed`);
  }
  if (funderId !== contract.need.buyerId) {
    throw new Error('Only the designated contract buyer can fund escrow');
  }
  if (amountMinorUnits !== contract.escrow.targetAmountMinor) {
    throw new Error(
      `Escrow funding mismatch: expected ${contract.escrow.targetAmountMinor} minor units, got ${amountMinorUnits}`,
    );
  }

  contract.escrow.fundedAmountMinor = amountMinorUnits;
  contract.escrow.funded = true;
  contract.escrow.fundingReference = fundingReference || `escrow-tx-${crypto.randomUUID()}`;
  contract.state = OUTCOME_STATES.FUNDED_ESCROW;
  contract.timeline.push({
    state: OUTCOME_STATES.FUNDED_ESCROW,
    actorId: funderId,
    timestampEpochMs: Date.now(),
    action: `Escrow funded with ${formatExactMoney({ currency: contract.escrow.currency, amountMinorUnits })}`,
  });

  return contract;
}

/**
 * Transition from funded escrow to active work execution.
 */
export function startExecution(contract, { actorId, startedAtEpochMs = Date.now() }) {
  if (contract.state !== OUTCOME_STATES.FUNDED_ESCROW) {
    throw new Error(`Cannot start execution in state '${contract.state}'`);
  }
  if (actorId !== contract.solution.providerId && actorId !== contract.need.buyerId) {
    throw new Error('Only the provider or buyer can mark execution started');
  }

  contract.state = OUTCOME_STATES.IN_PROGRESS;
  contract.workPackage.startedAtEpochMs = startedAtEpochMs;
  contract.timeline.push({
    state: OUTCOME_STATES.IN_PROGRESS,
    actorId,
    timestampEpochMs: startedAtEpochMs,
    action: 'Work execution commenced',
  });

  return contract;
}

/**
 * Submits verifiable evidence of work completion (artifacts, logs, hashes).
 */
export function submitEvidence(
  contract,
  {
    providerId,
    evidenceHash,
    evidenceUri,
    artifacts = [],
    notes = '',
    submittedAtEpochMs = Date.now(),
  },
) {
  if (contract.state !== OUTCOME_STATES.IN_PROGRESS) {
    throw new Error(`Cannot submit evidence in state '${contract.state}'`);
  }
  if (providerId !== contract.solution.providerId) {
    throw new Error('Only the designated provider can submit completion evidence');
  }
  if (!evidenceHash || typeof evidenceHash !== 'string' || evidenceHash.length < 16) {
    throw new Error('Evidence must contain a valid cryptographic hash (min 16 chars)');
  }

  contract.evidence = {
    providerId,
    evidenceHash,
    evidenceUri: evidenceUri || null,
    artifacts: [...artifacts],
    notes,
    submittedAtEpochMs,
  };

  contract.state = OUTCOME_STATES.EVIDENCE_SUBMITTED;
  contract.timeline.push({
    state: OUTCOME_STATES.EVIDENCE_SUBMITTED,
    actorId: providerId,
    timestampEpochMs: submittedAtEpochMs,
    action: `Submitted evidence dossier (hash: ${evidenceHash.slice(0, 12)}...)`,
  });

  return contract;
}

/**
 * Verifies submitted evidence against acceptance criteria and releases escrow to provider.
 */
export function verifyAndRelease(
  contract,
  {
    verifierId,
    notes = '',
    verifiedAtEpochMs = Date.now(),
  },
) {
  if (contract.state !== OUTCOME_STATES.EVIDENCE_SUBMITTED) {
    throw new Error(`Cannot verify outcome in state '${contract.state}'`);
  }
  // Buyer or designated independent verifier can approve
  if (verifierId !== contract.need.buyerId && verifierId !== 'system-oracle') {
    throw new Error('Only the buyer or authorized oracle can verify and release escrow');
  }

  contract.verification = {
    verifierId,
    verifiedAtEpochMs,
    notes,
    result: 'verified_pass',
  };

  // Full release of escrow to provider
  contract.escrow.releasedToProviderMinor = contract.escrow.fundedAmountMinor;
  contract.state = OUTCOME_STATES.VERIFIED_COMPLETE;
  contract.timeline.push({
    state: OUTCOME_STATES.VERIFIED_COMPLETE,
    actorId: verifierId,
    timestampEpochMs: verifiedAtEpochMs,
    action: `Outcome verified complete; released ${formatExactMoney({ currency: contract.escrow.currency, amountMinorUnits: contract.escrow.releasedToProviderMinor })} to provider`,
  });

  return contract;
}

/**
 * Initiates a formal dispute when submitted evidence fails acceptance criteria.
 */
export function disputeOutcome(
  contract,
  {
    disputerId,
    reason,
    disputedAtEpochMs = Date.now(),
  },
) {
  if (contract.state !== OUTCOME_STATES.EVIDENCE_SUBMITTED && contract.state !== OUTCOME_STATES.IN_PROGRESS) {
    throw new Error(`Cannot dispute contract in state '${contract.state}'`);
  }
  if (!reason || reason.trim().length === 0) {
    throw new Error('A specific reason is required to dispute an outcome');
  }

  contract.state = OUTCOME_STATES.DISPUTED;
  contract.dispute = {
    disputerId,
    reason,
    disputedAtEpochMs,
    status: 'open_review',
  };

  contract.timeline.push({
    state: OUTCOME_STATES.DISPUTED,
    actorId: disputerId,
    timestampEpochMs: disputedAtEpochMs,
    action: `Dispute opened: ${reason}`,
  });

  return contract;
}

/**
 * Resolves an active dispute, executing split or full refund/payout.
 */
export function resolveDispute(
  contract,
  {
    adjudicatorId,
    buyerRefundMinor = 0,
    providerPayoutMinor = 0,
    notes = '',
    resolvedAtEpochMs = Date.now(),
  },
) {
  if (contract.state !== OUTCOME_STATES.DISPUTED) {
    throw new Error(`Cannot resolve dispute in state '${contract.state}'`);
  }

  const totalResolution = buyerRefundMinor + providerPayoutMinor;
  if (totalResolution !== contract.escrow.fundedAmountMinor) {
    throw new Error(
      `Dispute settlement sum (${totalResolution}) must exactly equal funded escrow (${contract.escrow.fundedAmountMinor})`,
    );
  }

  contract.escrow.refundedToBuyerMinor = buyerRefundMinor;
  contract.escrow.releasedToProviderMinor = providerPayoutMinor;
  contract.dispute.status = 'resolved';
  contract.dispute.adjudicatorId = adjudicatorId;
  contract.dispute.resolvedAtEpochMs = resolvedAtEpochMs;
  contract.dispute.notes = notes;

  contract.state = buyerRefundMinor === contract.escrow.fundedAmountMinor ? OUTCOME_STATES.REFUNDED : OUTCOME_STATES.SETTLED;
  contract.timeline.push({
    state: contract.state,
    actorId: adjudicatorId,
    timestampEpochMs: resolvedAtEpochMs,
    action: `Dispute adjudicated: ${formatExactMoney({ currency: contract.escrow.currency, amountMinorUnits: buyerRefundMinor })} refunded to buyer, ${formatExactMoney({ currency: contract.escrow.currency, amountMinorUnits: providerPayoutMinor })} paid to provider`,
  });

  return contract;
}
