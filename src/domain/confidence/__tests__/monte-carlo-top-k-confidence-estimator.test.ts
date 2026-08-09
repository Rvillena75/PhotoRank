import { DEFAULT_RANKING_CONFIG } from '../../ranking-config';
import { applyComparison, createRankingSession } from '../../rating';
import { TsTrueSkillRatingEngine } from '../../../infrastructure/rating';
import {
  MonteCarloTopKConfidenceEstimator,
  createSeededRandom,
  evaluateStopRecommendation,
  INITIAL_STOP_RECOMMENDATION_STATE,
} from '..';
import type { TopKConfidenceResult } from '..';

const ratingEngine = new TsTrueSkillRatingEngine();

function sessionWithEvidence() {
  let session = createRankingSession(['a', 'b', 'c'], ratingEngine);
  session = applyComparison(session, { id: '1', leftPhotoId: 'a', rightPhotoId: 'b', outcome: { type: 'left' }, createdAt: 1 }, ratingEngine);
  session = applyComparison(session, { id: '2', leftPhotoId: 'a', rightPhotoId: 'c', outcome: { type: 'left' }, createdAt: 2 }, ratingEngine);
  session = applyComparison(session, { id: '3', leftPhotoId: 'b', rightPhotoId: 'c', outcome: { type: 'left' }, createdAt: 3 }, ratingEngine);
  return session;
}

function confidence(membershipStability: number, orderStability: number): TopKConfidenceResult {
  return {
    inclusionProbabilities: { a: 1, b: 0.5, c: 0.5 },
    membershipStability,
    orderStability,
    primaryStability: membershipStability,
    sampleCount: 100,
  };
}

describe('MonteCarloTopKConfidenceEstimator', () => {
  it('returns valid inclusion probabilities and deterministic results for an injected RNG', () => {
    const session = sessionWithEvidence();
    const estimator = new MonteCarloTopKConfidenceEstimator(300);
    const first = estimator.estimate(session, 2, createSeededRandom(77));
    const second = estimator.estimate(session, 2, createSeededRandom(77));

    expect(first).toEqual(second);
    expect(Object.values(first.inclusionProbabilities).every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(Object.values(first.inclusionProbabilities).reduce((total, value) => total + value, 0)).toBeCloseTo(2, 10);
    expect(first.membershipStability).toBeGreaterThanOrEqual(0);
    expect(first.orderStability).toBeLessThanOrEqual(1);
  });

  it('handles K=1 and K=N without conflating membership with ordering', () => {
    const session = sessionWithEvidence();
    const estimator = new MonteCarloTopKConfidenceEstimator(300);
    const one = estimator.estimate(session, 1, createSeededRandom(13));
    const all = estimator.estimate(session, 3, createSeededRandom(13));

    expect(one.primaryStability).toBe(one.membershipStability);
    expect(all.membershipStability).toBe(1);
    expect(all.primaryStability).toBe(all.orderStability);
    expect(all.orderStability).toBeLessThan(1);
  });

  it('uses enter/exit thresholds and a decision-count hysteresis before recommending a stop', () => {
    const session = sessionWithEvidence();
    const config = {
      ...DEFAULT_RANKING_CONFIG,
      confidence: {
        ...DEFAULT_RANKING_CONFIG.confidence,
        initialCoverageMatches: 1,
        minimumDecisions: 3,
        stableDecisionCount: 2,
        membershipEnterThreshold: 0.8,
        membershipExitThreshold: 0.7,
        orderEnterThreshold: 0.7,
        orderExitThreshold: 0.6,
      },
    };
    const first = evaluateStopRecommendation(session, confidence(0.85, 0.75), INITIAL_STOP_RECOMMENDATION_STATE, config);
    const second = evaluateStopRecommendation(session, confidence(0.72, 0.65), first.state, config);
    const third = evaluateStopRecommendation(session, confidence(0.69, 0.65), second.state, config);

    expect(first.recommendation.isStable).toBe(false);
    expect(second.recommendation.isStable).toBe(true);
    expect(third.recommendation.isStable).toBe(false);
  });
});
