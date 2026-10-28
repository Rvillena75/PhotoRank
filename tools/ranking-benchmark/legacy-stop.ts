import type { RankingConfig } from '../../src/domain/ranking-config';
import type { RankingSession } from '../../src/domain/rating';
import { getCoverage } from '../../src/domain/confidence';
import type { StopRecommendation, StopRecommendationState, TopKConfidenceResult } from '../../src/domain/confidence';

/** Original membership/order stop from 6ade4e3. Keep independent of production. */
export function evaluateLegacyStop(
  session: RankingSession,
  confidence: TopKConfidenceResult,
  previous: StopRecommendationState,
  config: RankingConfig,
): Readonly<{ recommendation: StopRecommendation; state: StopRecommendationState }> {
  const parameters = config.confidence;
  const coverage = getCoverage(session, parameters.initialCoverageMatches);
  const entering = confidence.membershipStability >= parameters.membershipEnterThreshold
    && confidence.orderStability >= parameters.orderEnterThreshold;
  const remaining = confidence.membershipStability >= parameters.membershipExitThreshold
    && confidence.orderStability >= parameters.orderExitThreshold;
  const eligible = coverage === 1 && session.history.length >= parameters.minimumDecisions
    && (previous.wasStable ? remaining : entering);
  const consecutiveStableDecisions = eligible ? previous.consecutiveStableDecisions + 1 : 0;
  const isStable = eligible && consecutiveStableDecisions >= parameters.stableDecisionCount;
  const isMaximumReached = session.history.length >= parameters.maximumDecisions;
  return Object.freeze({
    state: Object.freeze({ wasStable: eligible, consecutiveStableDecisions }),
    recommendation: Object.freeze({
      coverage,
      stabilityLevel: confidence.primaryStability >= parameters.membershipEnterThreshold
        ? 'very-stable' : confidence.primaryStability >= parameters.membershipExitThreshold ? 'fairly-stable' : 'initial',
      isStable,
      isCheckpointReached: isMaximumReached,
      isReviewPoint: isMaximumReached,
      isHardLimitReached: isMaximumReached,
      canContinueComparing: !isMaximumReached,
      requiresManualResolution: isMaximumReached && !isStable,
      canReviewSelection: isMaximumReached && !isStable,
      checkpointDecisions: parameters.maximumDecisions,
      nextReviewDecision: parameters.maximumDecisions,
      hardLimitDecisions: parameters.maximumDecisions,
      isMaximumReached,
      stableDecisionCount: consecutiveStableDecisions,
      reason: isMaximumReached && !isStable ? 'resolution-required' : isStable ? 'stable'
        : coverage < 1 ? 'collecting-coverage' : 'collecting-evidence',
    }),
  });
}
