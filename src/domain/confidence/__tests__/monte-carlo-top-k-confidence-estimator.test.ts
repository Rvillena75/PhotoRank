import { DEFAULT_RANKING_CONFIG } from '../../ranking-config';
import { applyComparison, createRankingSession } from '../../rating';
import { TsTrueSkillRatingEngine } from '../../../infrastructure/rating';
import {
  MonteCarloTopKConfidenceEstimator,
  createSeededRandom,
  evaluateStopRecommendation,
  getDynamicDecisionBudget,
  INITIAL_STOP_RECOMMENDATION_STATE,
} from '..';
import type { TopKConfidenceResult } from '..';
import type { RankingSession } from '../../rating';

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
    expectedTopKOverlap: membershipStability,
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
    expect(first.expectedTopKOverlap).toBeGreaterThanOrEqual(first.membershipStability);
    expect(first.expectedTopKOverlap).toBeLessThanOrEqual(1);
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
        expectedOverlapEnterThreshold: 0.8,
        expectedOverlapExitThreshold: 0.7,
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

  it('uses 2N as a checkpoint and 4N as a hard limit without blocking the extension', () => {
    const photoIds = Array.from({ length: 10 }, (_, index) => `photo-${index}`);
    const ratings = Object.fromEntries(photoIds.map((photoId) => [photoId, {
      mu: 25,
      sigma: 8,
      matches: 1,
      wins: 0,
      losses: 0,
      draws: 1,
    }]));
    const makeSession = (decisionCount: number): RankingSession => ({
      photoIds,
      ratings,
      history: Array.from({ length: decisionCount }, (_, index) => ({
        id: `decision-${index}`,
        leftPhotoId: photoIds[index % 10] ?? 'photo-0',
        rightPhotoId: photoIds[(index + 1) % 10] ?? 'photo-1',
        outcome: { type: 'skip' as const },
        createdAt: index,
      })),
    });
    const uncertain: TopKConfidenceResult = {
      inclusionProbabilities: Object.fromEntries(photoIds.map((photoId) => [photoId, 0.5])),
      expectedTopKOverlap: 0.6,
      membershipStability: 0.1,
      orderStability: 0.01,
      primaryStability: 0.1,
      sampleCount: 100,
    };
    const budget = getDynamicDecisionBudget(photoIds.length);
    const checkpoint = evaluateStopRecommendation(makeSession(budget.checkpointDecisions), uncertain);
    const extension = evaluateStopRecommendation(
      makeSession(budget.checkpointDecisions + budget.extensionBlockDecisions),
      uncertain,
    );
    const hardLimit = evaluateStopRecommendation(makeSession(budget.hardLimitDecisions), uncertain);

    expect(budget).toEqual({ checkpointDecisions: 20, extensionBlockDecisions: 5, hardLimitDecisions: 40 });
    expect(checkpoint.recommendation.reason).toBe('checkpoint-reached');
    expect(checkpoint.recommendation.canContinueComparing).toBe(true);
    expect(extension.recommendation.isReviewPoint).toBe(true);
    expect(hardLimit.recommendation.reason).toBe('resolution-required');
    expect(hardLimit.recommendation.requiresManualResolution).toBe(true);
    expect(hardLimit.recommendation.canContinueComparing).toBe(false);
  });

  it('tracks the displayed Top K when inclusion probabilities swap near the boundary', () => {
    const photoIds = Array.from({ length: 12 }, (_, index) => `photo-${String(index).padStart(2, '0')}`);
    const session: RankingSession = {
      photoIds,
      ratings: Object.fromEntries(photoIds.map((photoId, index) => [photoId, {
        mu: 40 - index, sigma: 5, matches: 1, wins: 0, losses: 0, draws: 1,
      }])),
      history: [{ id: '1', leftPhotoId: photoIds[0]!, rightPhotoId: photoIds[1]!, outcome: { type: 'draw' }, createdAt: 1 }],
    };
    const makeConfidence = (boundaryProbability: number): TopKConfidenceResult => ({
      inclusionProbabilities: Object.fromEntries(photoIds.map((photoId, index) => [photoId,
        index < 9 ? 1 : index === 9 ? boundaryProbability : index === 10 ? 1 - boundaryProbability : 0,
      ])),
      expectedTopKOverlap: (9 + boundaryProbability) / 10,
      membershipStability: boundaryProbability,
      orderStability: 0,
      primaryStability: boundaryProbability,
      sampleCount: 100,
    });
    const config = {
      ...DEFAULT_RANKING_CONFIG,
      confidence: { ...DEFAULT_RANKING_CONFIG.confidence, minimumDecisions: 1, stableDecisionCount: 2 },
    };
    const first = evaluateStopRecommendation(session, makeConfidence(0.51), INITIAL_STOP_RECOMMENDATION_STATE, config);
    const next = { ...session, history: [...session.history, { ...session.history[0]!, id: '2', createdAt: 2 }] };
    const second = evaluateStopRecommendation(next, makeConfidence(0.49), first.state, config);
    expect(first.recommendation.isStable).toBe(false);
    expect(second.recommendation.isStable).toBe(true);

    const changed = {
      ...next,
      ratings: { ...next.ratings, [photoIds[10]!]: { ...next.ratings[photoIds[10]!]!, mu: 40 } },
    };
    const third = evaluateStopRecommendation(changed, makeConfidence(0.49), second.state, config);
    expect(third.recommendation.isStable).toBe(false);
    expect(third.recommendation.stableDecisionCount).toBe(1);
  });

  it('offers voluntary confirmation at 20 decisions after coverage without declaring stability', () => {
    const photoIds = Array.from({ length: 20 }, (_, index) => `photo-${index}`);
    let session = createRankingSession(photoIds, ratingEngine);
    const uncertain: TopKConfidenceResult = {
      inclusionProbabilities: Object.fromEntries(photoIds.map((photoId) => [photoId, 0.25])),
      expectedTopKOverlap: 0.25, membershipStability: 0, orderStability: 0,
      primaryStability: 0, sampleCount: 100,
    };
    for (let index = 0; index < 20; index += 1) {
      if (index === 19) {
        expect(evaluateStopRecommendation(session, uncertain).recommendation.canReviewSelection).toBe(false);
      }
      session = applyComparison(session, {
        id: String(index), leftPhotoId: photoIds[(2 * index) % 20]!,
        rightPhotoId: photoIds[(2 * index + 1) % 20]!, outcome: { type: 'draw' }, createdAt: index,
      }, ratingEngine);
    }
    const { recommendation } = evaluateStopRecommendation(session, uncertain);
    expect(recommendation.canReviewSelection).toBe(true);
    expect(recommendation.isStable).toBe(false);
    expect(recommendation.requiresManualResolution).toBe(false);
    expect(recommendation.isCheckpointReached).toBe(false);
    expect(recommendation.canContinueComparing).toBe(true);

    const skipped = session.history.reduce((current, record) => applyComparison(current,
      { ...record, outcome: { type: 'skip' } }, ratingEngine), createRankingSession(photoIds, ratingEngine));
    expect(evaluateStopRecommendation(skipped, uncertain).recommendation.canReviewSelection).toBe(false);
  });
});
