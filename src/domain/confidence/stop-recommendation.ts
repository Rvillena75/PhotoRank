import type { RankingConfig } from '../ranking-config';
import { DEFAULT_RANKING_CONFIG } from '../ranking-config';
import type { RankingSession } from '../rating';
import type { StopRecommendation, StopRecommendationState, TopKConfidenceResult } from './types';

export const INITIAL_STOP_RECOMMENDATION_STATE: StopRecommendationState = Object.freeze({
  wasStable: false,
  consecutiveStableDecisions: 0,
});

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
  const hasMinimumEvidence = session.history.length >= parameters.minimumDecisions;
  const enteringStable = confidence.membershipStability >= parameters.membershipEnterThreshold
    && confidence.orderStability >= parameters.orderEnterThreshold;
  const remainingStable = confidence.membershipStability >= parameters.membershipExitThreshold
    && confidence.orderStability >= parameters.orderExitThreshold;
  const meetsThreshold = previous.wasStable ? remainingStable : enteringStable;
  const eligible = coverage === 1 && hasMinimumEvidence && meetsThreshold;
  const consecutiveStableDecisions = eligible ? previous.consecutiveStableDecisions + 1 : 0;
  const isStable = eligible && consecutiveStableDecisions >= parameters.stableDecisionCount;
  const isMaximumReached = session.history.length >= parameters.maximumDecisions;
  // Retain the entered hysteresis band while evidence is accumulating; the
  // user-facing recommendation only becomes stable after enough decisions.
  const state = Object.freeze({ wasStable: eligible, consecutiveStableDecisions });
  const stabilityLevel = confidence.primaryStability >= parameters.membershipEnterThreshold
    ? 'very-stable'
    : confidence.primaryStability >= parameters.membershipExitThreshold ? 'fairly-stable' : 'initial';
  const reason = isMaximumReached
    ? 'maximum-reached'
    : isStable ? 'stable'
    : coverage < 1 ? 'collecting-coverage' : 'collecting-evidence';
  return Object.freeze({
    state,
    recommendation: Object.freeze({
      coverage,
      stabilityLevel,
      isStable,
      isMaximumReached,
      stableDecisionCount: consecutiveStableDecisions,
      reason,
    }),
  });
}
