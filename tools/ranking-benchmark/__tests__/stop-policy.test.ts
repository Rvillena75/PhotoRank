import * as confidence from '../../../src/domain/confidence';
import * as stopPolicy from '../../../src/domain/confidence/stop-recommendation';
import type { TopKConfidenceResult } from '../../../src/domain/confidence';
import { DEFAULT_RANKING_CONFIG } from '../../../src/domain/ranking-config';
import { applyComparison, createRankingSession, getTopK } from '../../../src/domain/rating';
import { TsTrueSkillRatingEngine } from '../../../src/infrastructure/rating';
import { SYNTHETIC_FIXTURES } from '../fixtures';
import { HUMAN_PROFILES } from '../human-simulator';
import { evaluateLegacyStop } from '../legacy-stop';
import { BENCHMARK_VARIANTS, runBenchmark } from '../runner';

describe('benchmark stop policies', () => {
  it('uses the production evaluator and reports its actual manual-resolution decision', () => {
    const evaluate = jest.spyOn(stopPolicy, 'evaluateStopRecommendation');
    try {
      const report = runBenchmark({
        sessionsPerScenario: 1,
        confidenceSamples: 40,
        fixtures: SYNTHETIC_FIXTURES.slice(0, 1),
        profiles: HUMAN_PROFILES.slice(1, 2),
        variants: BENCHMARK_VARIANTS.filter(({ id }) => id === 'production-checkpoint-2n-hard-4n'),
      });
      const result = report.sessions[0]!;
      expect(evaluate).toHaveBeenCalledTimes(result.decisionsPresented);
      const call = evaluate.mock.calls.at(-1)!;
      const evaluation = evaluate.mock.results.at(-1)!;
      if (evaluation.type !== 'return') throw new Error('Production evaluator failed.');
      expect(result.producedTopK).toEqual(getTopK(call[0], result.k));
      expect(result.automaticallyStopped).toBe(evaluation.value.recommendation.isStable);
      expect(result.manualBoundaryResolutionRequired).toBe(evaluation.value.recommendation.requiresManualResolution);
    } finally {
      evaluate.mockRestore();
    }
  });

  it('retains the original order requirement only in the historical baseline', () => {
    const engine = new TsTrueSkillRatingEngine();
    let session = createRankingSession(['a', 'b', 'c'], engine);
    for (let index = 0; index < 8; index += 1) {
      session = applyComparison(session, {
        id: String(index), leftPhotoId: 'a', rightPhotoId: index % 2 === 0 ? 'b' : 'c',
        outcome: { type: 'left' }, createdAt: index,
      }, engine);
    }
    const estimated: TopKConfidenceResult = {
      inclusionProbabilities: { a: 1, b: 0.9, c: 0.1 },
      expectedTopKOverlap: 0.95, membershipStability: 0.9,
      orderStability: 0.1, primaryStability: 0.9, sampleCount: 100,
    };
    const config = {
      ...DEFAULT_RANKING_CONFIG,
      confidence: { ...DEFAULT_RANKING_CONFIG.confidence, stableDecisionCount: 1 },
    };
    const initial = confidence.INITIAL_STOP_RECOMMENDATION_STATE;
    expect(confidence.evaluateStopRecommendation(session, estimated, initial, config).recommendation.isStable).toBe(true);
    expect(evaluateLegacyStop(session, estimated, initial, config).recommendation.isStable).toBe(false);
  });
});
