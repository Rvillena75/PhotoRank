import type { RankingConfig } from '../ranking-config';
import { DEFAULT_RANKING_CONFIG } from '../ranking-config';
import { getTopK } from '../rating';
import type { RankingSession } from '../rating';
import type { StopRecommendation, StopRecommendationState, TopKConfidenceResult } from './types';

export const INITIAL_STOP_RECOMMENDATION_STATE: StopRecommendationState = Object.freeze({
  wasStable: false,
  consecutiveStableDecisions: 0,
});

export interface DynamicDecisionBudget {
  readonly checkpointDecisions: number;
  readonly extensionBlockDecisions: number;
  readonly hardLimitDecisions: number;
}

function membershipKey(photoIds: readonly string[]): string {
  return [...photoIds].sort((left, right) => left.localeCompare(right)).join('\u0001');
}

function validateMultiplier(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive.`);
}

export function getDynamicDecisionBudget(
  photoCount: number,
  config: RankingConfig = DEFAULT_RANKING_CONFIG,
): DynamicDecisionBudget {
  if (!Number.isInteger(photoCount) || photoCount < 1) {
    throw new RangeError('Photo count must be a positive integer.');
  }
  const parameters = config.confidence;
  validateMultiplier(parameters.checkpointMultiplier, 'Checkpoint multiplier');
  validateMultiplier(parameters.extensionBlockMultiplier, 'Extension block multiplier');
  validateMultiplier(parameters.hardMaximumMultiplier, 'Hard maximum multiplier');
  const checkpointDecisions = Math.max(parameters.minimumDecisions, Math.ceil(parameters.checkpointMultiplier * photoCount));
  const extensionBlockDecisions = Math.max(1, Math.ceil(parameters.extensionBlockMultiplier * photoCount));
  const hardLimitDecisions = Math.max(
    checkpointDecisions + extensionBlockDecisions,
    Math.ceil(parameters.hardMaximumMultiplier * photoCount),
  );
  return Object.freeze({ checkpointDecisions, extensionBlockDecisions, hardLimitDecisions });
}

export function getCoverage(session: RankingSession, requiredMatches: number): number {
  if (requiredMatches < 1) throw new RangeError('Required coverage must be positive.');
  const matched = session.photoIds.reduce((total, photoId) => total + Math.min(requiredMatches, session.ratings[photoId]?.matches ?? 0), 0);
  return matched / (session.photoIds.length * requiredMatches);
}

export function evaluateStopRecommendation(
  session: RankingSession,
  confidence: TopKConfidenceResult,
  previous: StopRecommendationState = INITIAL_STOP_RECOMMENDATION_STATE,
  config: RankingConfig = DEFAULT_RANKING_CONFIG,
): Readonly<{ recommendation: StopRecommendation; state: StopRecommendationState }> {
  const parameters = config.confidence;
  const coverage = getCoverage(session, parameters.initialCoverageMatches);
  const informativeDecisionCount = session.history.filter(({ outcome }) => outcome.type !== 'skip').length;
  const hasMinimumEvidence = informativeDecisionCount >= parameters.minimumDecisions;
  const enteringStable = confidence.expectedTopKOverlap >= parameters.expectedOverlapEnterThreshold;
  const remainingStable = confidence.expectedTopKOverlap >= parameters.expectedOverlapExitThreshold;
  const meetsThreshold = previous.wasStable ? remainingStable : enteringStable;
  // Inclusion probabilities sum to K. Track the result actually shown by getTopK,
  // rather than a different set that can fluctuate with Monte Carlo sampling.
  const k = Math.round(Object.values(confidence.inclusionProbabilities).reduce((total, probability) => total + probability, 0));
  const currentMembershipKey = membershipKey(getTopK(session, k));
  const lastDecision = session.history[session.history.length - 1];
  const informativeDecision = lastDecision !== undefined && lastDecision.outcome.type !== 'skip';
  const sameMembership = previous.lastMembershipKey === undefined
    || previous.lastMembershipKey === currentMembershipKey;
  const isAllPhotosSelected = Math.abs(
    Object.values(confidence.inclusionProbabilities).reduce((total, probability) => total + probability, 0)
      - session.photoIds.length,
  ) < 1e-6;
  const eligible = coverage === 1 && (isAllPhotosSelected || (hasMinimumEvidence && meetsThreshold));
  const consecutiveStableDecisions = informativeDecision
    ? (eligible && sameMembership ? previous.consecutiveStableDecisions + 1 : eligible ? 1 : 0)
    : previous.consecutiveStableDecisions;
  const isStable = eligible && (isAllPhotosSelected || consecutiveStableDecisions >= parameters.stableDecisionCount);
  const budget = getDynamicDecisionBudget(session.photoIds.length, config);
  const decisionsPresented = session.history.length;
  const isCheckpointReached = decisionsPresented >= budget.checkpointDecisions;
  const isHardLimitReached = decisionsPresented >= budget.hardLimitDecisions;
  const decisionsAfterCheckpoint = decisionsPresented - budget.checkpointDecisions;
  const isReviewPoint = decisionsPresented === budget.checkpointDecisions
    || (decisionsAfterCheckpoint > 0
      && decisionsPresented < budget.hardLimitDecisions
      && decisionsAfterCheckpoint % budget.extensionBlockDecisions === 0);
  const nextReviewDecision = decisionsPresented < budget.checkpointDecisions
    ? budget.checkpointDecisions
    : Math.min(
      budget.hardLimitDecisions,
      budget.checkpointDecisions
        + (Math.floor(Math.max(0, decisionsAfterCheckpoint) / budget.extensionBlockDecisions) + 1)
          * budget.extensionBlockDecisions,
    );
  const requiresManualResolution = isHardLimitReached && !isStable;
  const canReviewSelection = requiresManualResolution
    || (coverage === 1 && decisionsPresented >= parameters.earlyReviewDecisions);
  const state = Object.freeze({
    wasStable: eligible,
    consecutiveStableDecisions,
    lastMembershipKey: informativeDecision ? currentMembershipKey : previous.lastMembershipKey,
  });
  const stabilityLevel = confidence.expectedTopKOverlap >= parameters.expectedOverlapEnterThreshold
    ? 'very-stable'
    : confidence.expectedTopKOverlap >= parameters.expectedOverlapExitThreshold ? 'fairly-stable' : 'initial';
  const reason: StopRecommendation['reason'] = requiresManualResolution
    ? 'resolution-required'
    : isStable ? 'stable'
    : isReviewPoint ? 'checkpoint-reached'
    : isCheckpointReached ? 'extending-evidence'
    : coverage < 1 ? 'collecting-coverage' : 'collecting-evidence';
  return Object.freeze({
    state,
    recommendation: Object.freeze({
      coverage,
      stabilityLevel,
      isStable,
      isCheckpointReached,
      isReviewPoint,
      isHardLimitReached,
      canContinueComparing: !isHardLimitReached,
      requiresManualResolution,
      canReviewSelection,
      checkpointDecisions: budget.checkpointDecisions,
      nextReviewDecision,
      hardLimitDecisions: budget.hardLimitDecisions,
      isMaximumReached: isHardLimitReached,
      stableDecisionCount: consecutiveStableDecisions,
      reason,
    }),
  });
}
