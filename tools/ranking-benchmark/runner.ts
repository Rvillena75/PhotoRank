import {
  createSeededRandom,
  evaluateStopRecommendation,
  getCoverage,
  getDynamicDecisionBudget,
  INITIAL_STOP_RECOMMENDATION_STATE,
  MonteCarloTopKConfidenceEstimator,
} from '../../src/domain/confidence';
import type {
  StopRecommendation,
  StopRecommendationState,
  TopKConfidenceResult,
} from '../../src/domain/confidence';
import {
  AdaptivePairSelectionEngine,
  BalancedEvidencePairSelectionEngine,
  DEFAULT_BALANCED_EVIDENCE_PARAMETERS,
  DEFAULT_TOP_K_INFORMATION_GAIN_PARAMETERS,
  DEFAULT_TOP_TWO_THOMPSON_PARAMETERS,
  TopKInformationGainPairSelectionEngine,
  TopTwoThompsonPairSelectionEngine,
} from '../../src/domain/pair-selection';
import type { PairSelectionEngine } from '../../src/domain/pair-selection';
import type { PairSelectionParameters, RankingConfig } from '../../src/domain/ranking-config';
import { DEFAULT_RANKING_CONFIG } from '../../src/domain/ranking-config';
import {
  applyComparison,
  createRankingSession,
  getTopK,
  rankPhotoIds,
} from '../../src/domain/rating';
import type {
  ComparisonOutcome,
  ComparisonRecord,
  RankingSession,
  RatingEngine,
} from '../../src/domain/rating';
import { BradleyTerryRatingEngine, TsTrueSkillRatingEngine } from '../../src/infrastructure/rating';
import { evaluateCarouselPolicies } from './carousel';
import { SYNTHETIC_FIXTURES } from './fixtures';
import { HumanDecisionSimulator, HUMAN_PROFILES } from './human-simulator';
import { evaluateLegacyStop } from './legacy-stop';
import type {
  AggregateMetrics,
  BenchmarkOptions,
  BenchmarkReport,
  BenchmarkVariant,
  CalibrationBucket,
  CarouselAggregate,
  CarouselPolicyId,
  GateEvaluation,
  HumanProfile,
  RankingFixture,
  SessionResult,
  SummaryStats,
} from './types';

const TRUE_SKILL_RATING_ENGINE = new TsTrueSkillRatingEngine();
const BRADLEY_TERRY_RATING_ENGINE = new BradleyTerryRatingEngine();

const FRONTIER_CHALLENGER_OVERRIDES: Readonly<Partial<PairSelectionParameters>> = Object.freeze({
  initialCoverageMatches: 1,
  uncertaintyWeight: 2.5,
  ratingProximityWeight: 2.5,
  frontierWeight: 10,
  frontierCrossingBonus: 8,
  lowExposureWeight: 1.5,
  repeatedPairPenalty: 2.5,
});

export const BENCHMARK_VARIANTS: readonly BenchmarkVariant[] = Object.freeze([
  Object.freeze({
    id: 'current-baseline',
    label: 'Baseline actual',
    description: 'Selector y criterio de parada actuales, con dos comparaciones de cobertura y máximo 100.',
    selector: 'adaptive',
    ratingModel: 'true-skill',
    pairSelectionOverrides: Object.freeze({ initialCoverageMatches: 2 }),
    stopPolicy: 'legacy-membership',
    minimumDecisions: DEFAULT_RANKING_CONFIG.confidence.minimumDecisions,
    maximumDecisions: 'legacy',
    expectedOverlapEnterThreshold: 0.9,
    expectedOverlapExitThreshold: 0.84,
    stableDecisionCount: DEFAULT_RANKING_CONFIG.confidence.stableDecisionCount,
  }),
  Object.freeze({
    id: 'current-one-coverage',
    label: 'Actual con una cobertura',
    description: 'Mismo selector actual, pero exige una sola comparación informativa por foto.',
    selector: 'adaptive',
    ratingModel: 'true-skill',
    pairSelectionOverrides: Object.freeze({ initialCoverageMatches: 1 }),
    stopPolicy: 'legacy-membership',
    minimumDecisions: DEFAULT_RANKING_CONFIG.confidence.minimumDecisions,
    maximumDecisions: 'legacy',
    expectedOverlapEnterThreshold: 0.9,
    expectedOverlapExitThreshold: 0.84,
    stableDecisionCount: DEFAULT_RANKING_CONFIG.confidence.stableDecisionCount,
  }),
  Object.freeze({
    id: 'current-selector-dynamic-90',
    label: 'Selector actual + presupuesto dinámico',
    description: 'Aísla el nuevo stop y máximo 2N sin cambiar los pesos del selector actual.',
    selector: 'adaptive',
    ratingModel: 'true-skill',
    pairSelectionOverrides: Object.freeze({ initialCoverageMatches: 1 }),
    stopPolicy: 'expected-overlap',
    minimumDecisions: DEFAULT_RANKING_CONFIG.confidence.minimumDecisions,
    maximumDecisions: 'dynamic',
    expectedOverlapEnterThreshold: 0.9,
    expectedOverlapExitThreshold: 0.84,
    stableDecisionCount: 3,
  }),
  Object.freeze({
    id: 'production-checkpoint-2n-hard-4n',
    label: 'Producción: checkpoint 2N + límite 4N',
    description: 'Selector actual, una cobertura, parada estable y extensión hasta el límite de seguridad 4N.',
    selector: 'adaptive',
    ratingModel: 'true-skill',
    pairSelectionOverrides: Object.freeze({ initialCoverageMatches: 1 }),
    stopPolicy: 'production',
    minimumDecisions: DEFAULT_RANKING_CONFIG.confidence.minimumDecisions,
    maximumDecisions: 'hybrid',
    expectedOverlapEnterThreshold: DEFAULT_RANKING_CONFIG.confidence.expectedOverlapEnterThreshold,
    expectedOverlapExitThreshold: DEFAULT_RANKING_CONFIG.confidence.expectedOverlapExitThreshold,
    stableDecisionCount: DEFAULT_RANKING_CONFIG.confidence.stableDecisionCount,
  }),
  Object.freeze({
    id: 'frontier-expected-overlap-90',
    label: 'Retador frontera + overlap 0.90',
    description: 'Pesos de frontera más agresivos, una cobertura y parada por expectedTopKOverlap.',
    selector: 'adaptive',
    ratingModel: 'true-skill',
    pairSelectionOverrides: FRONTIER_CHALLENGER_OVERRIDES,
    stopPolicy: 'expected-overlap',
    minimumDecisions: DEFAULT_RANKING_CONFIG.confidence.minimumDecisions,
    maximumDecisions: 'dynamic',
    expectedOverlapEnterThreshold: 0.9,
    expectedOverlapExitThreshold: 0.84,
    stableDecisionCount: 3,
  }),
  Object.freeze({
    id: 'frontier-expected-overlap-85',
    label: 'Retador frontera + overlap 0.85',
    description: 'Variante de menor umbral para observar el costo de terminar antes.',
    selector: 'adaptive',
    ratingModel: 'true-skill',
    pairSelectionOverrides: FRONTIER_CHALLENGER_OVERRIDES,
    stopPolicy: 'expected-overlap',
    minimumDecisions: DEFAULT_RANKING_CONFIG.confidence.minimumDecisions,
    maximumDecisions: 'dynamic',
    expectedOverlapEnterThreshold: 0.85,
    expectedOverlapExitThreshold: 0.8,
    stableDecisionCount: 3,
  }),
  Object.freeze({
    id: 'frontier-expected-overlap-95',
    label: 'Retador frontera + overlap 0.95',
    description: 'Variante de mayor umbral para observar el costo de buscar más fidelidad.',
    selector: 'adaptive',
    ratingModel: 'true-skill',
    pairSelectionOverrides: FRONTIER_CHALLENGER_OVERRIDES,
    stopPolicy: 'expected-overlap',
    minimumDecisions: DEFAULT_RANKING_CONFIG.confidence.minimumDecisions,
    maximumDecisions: 'dynamic',
    expectedOverlapEnterThreshold: 0.95,
    expectedOverlapExitThreshold: 0.9,
    stableDecisionCount: 3,
  }),
  Object.freeze({
    id: 'top-k-information-gain-90',
    label: 'Ganancia de información Top K + overlap 0.90',
    description: 'Look-ahead de un paso que minimiza la entropía esperada de pertenencia al Top K.',
    selector: 'top-k-information-gain',
    ratingModel: 'true-skill',
    pairSelectionOverrides: Object.freeze({ initialCoverageMatches: 1 }),
    informationGainOverrides: Object.freeze({ posteriorSamples: 64, candidatePoolSize: 6 }),
    stopPolicy: 'expected-overlap',
    minimumDecisions: DEFAULT_RANKING_CONFIG.confidence.minimumDecisions,
    maximumDecisions: 'dynamic',
    expectedOverlapEnterThreshold: 0.9,
    expectedOverlapExitThreshold: 0.84,
    stableDecisionCount: 3,
  }),
  Object.freeze({
    id: 'bradley-terry-adaptive-90',
    label: 'Bradley-Terry global + selector actual',
    description: 'Posterior MAP global independiente del orden, una cobertura y parada por overlap.',
    selector: 'adaptive',
    ratingModel: 'bradley-terry',
    pairSelectionOverrides: Object.freeze({ initialCoverageMatches: 1 }),
    stopPolicy: 'expected-overlap',
    minimumDecisions: DEFAULT_RANKING_CONFIG.confidence.minimumDecisions,
    maximumDecisions: 'dynamic',
    expectedOverlapEnterThreshold: 0.9,
    expectedOverlapExitThreshold: 0.84,
    stableDecisionCount: 3,
  }),
  Object.freeze({
    id: 'bradley-terry-frontier-90',
    label: 'Bradley-Terry global + frontera',
    description: 'Posterior MAP global con selector de frontera agresivo y parada por overlap.',
    selector: 'adaptive',
    ratingModel: 'bradley-terry',
    pairSelectionOverrides: FRONTIER_CHALLENGER_OVERRIDES,
    stopPolicy: 'expected-overlap',
    minimumDecisions: DEFAULT_RANKING_CONFIG.confidence.minimumDecisions,
    maximumDecisions: 'dynamic',
    expectedOverlapEnterThreshold: 0.9,
    expectedOverlapExitThreshold: 0.84,
    stableDecisionCount: 3,
  }),
  Object.freeze({
    id: 'balanced-evidence-3-frontier-90',
    label: 'Tres evidencias por foto + frontera',
    description: 'Cobertura balanceada hasta tres resultados por foto y luego retador de frontera.',
    selector: 'balanced-evidence',
    ratingModel: 'true-skill',
    pairSelectionOverrides: FRONTIER_CHALLENGER_OVERRIDES,
    balancedEvidenceOverrides: Object.freeze({ evidenceMatchesPerPhoto: 3 }),
    stopPolicy: 'expected-overlap',
    minimumDecisions: DEFAULT_RANKING_CONFIG.confidence.minimumDecisions,
    maximumDecisions: 'dynamic',
    expectedOverlapEnterThreshold: 0.9,
    expectedOverlapExitThreshold: 0.84,
    stableDecisionCount: 3,
  }),
  Object.freeze({
    id: 'balanced-evidence-2-frontier-90',
    label: 'Dos evidencias por foto + frontera',
    description: 'Cobertura balanceada hasta dos resultados por foto y luego retador de frontera.',
    selector: 'balanced-evidence',
    ratingModel: 'true-skill',
    pairSelectionOverrides: FRONTIER_CHALLENGER_OVERRIDES,
    balancedEvidenceOverrides: Object.freeze({ evidenceMatchesPerPhoto: 2 }),
    stopPolicy: 'expected-overlap',
    minimumDecisions: DEFAULT_RANKING_CONFIG.confidence.minimumDecisions,
    maximumDecisions: 'dynamic',
    expectedOverlapEnterThreshold: 0.9,
    expectedOverlapExitThreshold: 0.84,
    stableDecisionCount: 3,
  }),
  Object.freeze({
    id: 'top-two-thompson-90',
    label: 'Top-Two Thompson Top K',
    description: 'Compara el intercambio interior/exterior más frecuente en muestras del posterior.',
    selector: 'top-two-thompson',
    ratingModel: 'true-skill',
    pairSelectionOverrides: Object.freeze({ initialCoverageMatches: 1 }),
    topTwoThompsonOverrides: Object.freeze({ posteriorSamples: 256 }),
    stopPolicy: 'expected-overlap',
    minimumDecisions: DEFAULT_RANKING_CONFIG.confidence.minimumDecisions,
    maximumDecisions: 'dynamic',
    expectedOverlapEnterThreshold: 0.9,
    expectedOverlapExitThreshold: 0.84,
    stableDecisionCount: 3,
  }),
]);

interface ExpectedOverlapStopState {
  readonly wasStable: boolean;
  readonly consecutiveStableDecisions: number;
  readonly lastMembershipKey?: string;
}

const INITIAL_EXPECTED_OVERLAP_STOP_STATE: ExpectedOverlapStopState = Object.freeze({
  wasStable: false,
  consecutiveStableDecisions: 0,
});

interface StopEvaluation {
  readonly recommendation: StopRecommendation;
  readonly state: ExpectedOverlapStopState | StopRecommendationState;
}

function membershipKey(photoIds: readonly string[]): string {
  return [...photoIds].sort((left, right) => left.localeCompare(right)).join('\u0001');
}

function buildPairSelectionParameters(variant: BenchmarkVariant): PairSelectionParameters {
  return Object.freeze({
    ...DEFAULT_RANKING_CONFIG.pairSelection,
    ...variant.pairSelectionOverrides,
  });
}

function buildSelector(
  variant: BenchmarkVariant,
  pairSelection: PairSelectionParameters,
  ratingEngine: RatingEngine,
): PairSelectionEngine {
  if (variant.selector === 'top-two-thompson') {
    return new TopTwoThompsonPairSelectionEngine(
      Object.freeze({
        ...DEFAULT_TOP_TWO_THOMPSON_PARAMETERS,
        ...variant.topTwoThompsonOverrides,
      }),
      pairSelection,
    );
  }
  if (variant.selector === 'balanced-evidence') {
    return new BalancedEvidencePairSelectionEngine(
      Object.freeze({
        ...DEFAULT_BALANCED_EVIDENCE_PARAMETERS,
        ...variant.balancedEvidenceOverrides,
      }),
      pairSelection,
    );
  }
  if (variant.selector === 'top-k-information-gain') {
    return new TopKInformationGainPairSelectionEngine(
      ratingEngine,
      Object.freeze({
        ...DEFAULT_TOP_K_INFORMATION_GAIN_PARAMETERS,
        ...variant.informationGainOverrides,
      }),
      pairSelection,
    );
  }
  return new AdaptivePairSelectionEngine(pairSelection);
}

function buildRatingEngine(variant: BenchmarkVariant): RatingEngine {
  return variant.ratingModel === 'bradley-terry'
    ? BRADLEY_TERRY_RATING_ENGINE
    : TRUE_SKILL_RATING_ENGINE;
}

function buildLegacyConfig(
  variant: BenchmarkVariant,
  pairSelection: PairSelectionParameters,
): RankingConfig {
  return Object.freeze({
    ...DEFAULT_RANKING_CONFIG,
    pairSelection: Object.freeze({ ...pairSelection }),
    confidence: Object.freeze({
      ...DEFAULT_RANKING_CONFIG.confidence,
      initialCoverageMatches: pairSelection.initialCoverageMatches,
      minimumDecisions: variant.minimumDecisions,
      maximumDecisions: 100,
    }),
  });
}

function evaluateExpectedOverlapStop(
  session: RankingSession,
  confidence: TopKConfidenceResult,
  previous: ExpectedOverlapStopState,
  variant: BenchmarkVariant,
  k: number,
  maximumDecisions: number,
  informativeDecision: boolean,
  coverageMatches: number,
): StopEvaluation {
  const coverage = getCoverage(session, coverageMatches);
  const hasMinimumEvidence = session.history.filter(({ outcome }) => outcome.type !== 'skip').length >= variant.minimumDecisions;
  const currentMembershipKey = membershipKey(getTopK(session, k));
  const sameMembership = previous.lastMembershipKey === undefined
    || previous.lastMembershipKey === currentMembershipKey;
  const consecutiveStableDecisions = informativeDecision
    ? (sameMembership ? previous.consecutiveStableDecisions + 1 : 1)
    : previous.consecutiveStableDecisions;
  const enteringStable = confidence.expectedTopKOverlap >= variant.expectedOverlapEnterThreshold;
  const remainingStable = confidence.expectedTopKOverlap >= variant.expectedOverlapExitThreshold;
  const meetsThreshold = previous.wasStable ? remainingStable : enteringStable;
  const isAllPhotosSelected = k === session.photoIds.length;
  const eligible = coverage === 1
    && (isAllPhotosSelected || (hasMinimumEvidence && meetsThreshold));
  const isStable = eligible && (isAllPhotosSelected || (
    consecutiveStableDecisions >= variant.stableDecisionCount
    && sameMembership
  ));
  const isMaximumReached = session.history.length >= maximumDecisions;
  const state: ExpectedOverlapStopState = Object.freeze({
    wasStable: eligible,
    consecutiveStableDecisions,
    lastMembershipKey: informativeDecision ? currentMembershipKey : previous.lastMembershipKey,
  });
  const stabilityLevel = confidence.expectedTopKOverlap >= variant.expectedOverlapEnterThreshold
    ? 'very-stable'
    : confidence.expectedTopKOverlap >= variant.expectedOverlapExitThreshold ? 'fairly-stable' : 'initial';
  const reason = isMaximumReached
    ? 'resolution-required'
    : isStable ? 'stable'
    : coverage < 1 ? 'collecting-coverage' : 'collecting-evidence';

  return {
    state,
    recommendation: Object.freeze({
      coverage,
      stabilityLevel,
      isStable,
      isCheckpointReached: isMaximumReached,
      isReviewPoint: isMaximumReached,
      isHardLimitReached: isMaximumReached,
      canContinueComparing: !isMaximumReached,
      requiresManualResolution: isMaximumReached && !isStable,
      canReviewSelection: isMaximumReached && !isStable,
      checkpointDecisions: maximumDecisions,
      nextReviewDecision: maximumDecisions,
      hardLimitDecisions: maximumDecisions,
      isMaximumReached,
      stableDecisionCount: consecutiveStableDecisions,
      reason,
    }),
  };
}

function maximumFor(variant: BenchmarkVariant, fixture: RankingFixture): number {
  if (variant.maximumDecisions === 'dynamic') return Math.max(8, 2 * fixture.photoIds.length);
  if (variant.maximumDecisions === 'hybrid') return getDynamicDecisionBudget(fixture.photoIds.length).hardLimitDecisions;
  return 100;
}

function countCorrect(
  producedTopK: readonly string[],
  acceptablePhotoIds: readonly string[],
): number {
  const acceptable = new Set(acceptablePhotoIds);
  return producedTopK.reduce((count, photoId) => count + (acceptable.has(photoId) ? 1 : 0), 0);
}

function tierAwareRecall(
  producedPhotoIds: readonly string[],
  fixture: RankingFixture,
  requestedSize: number,
): number {
  if (requestedSize <= 0) return 1;
  const produced = new Set(producedPhotoIds);
  let remaining = requestedSize;
  let correct = 0;
  for (const tier of fixture.tiers) {
    if (remaining <= 0) break;
    const tierCapacity = Math.min(remaining, tier.length);
    const matched = tier.reduce((count, photoId) => count + (produced.has(photoId) ? 1 : 0), 0);
    correct += Math.min(tierCapacity, matched);
    remaining -= tierCapacity;
  }
  return correct / requestedSize;
}

function tierTolerantOrderScore(
  producedTopK: readonly string[],
  fixture: RankingFixture,
): number {
  if (producedTopK.length < 2) return 1;
  let correctPairs = 0;
  let totalPairs = 0;
  for (let leftIndex = 0; leftIndex < producedTopK.length; leftIndex += 1) {
    const leftPhotoId = producedTopK[leftIndex];
    if (!leftPhotoId) continue;
    const leftTier = fixture.tierByPhotoId[leftPhotoId];
    for (let rightIndex = leftIndex + 1; rightIndex < producedTopK.length; rightIndex += 1) {
      const rightPhotoId = producedTopK[rightIndex];
      if (rightPhotoId === undefined || leftTier === undefined) continue;
      const rightTier = fixture.tierByPhotoId[rightPhotoId];
      if (rightTier === undefined) continue;
      totalPairs += 1;
      if (leftTier <= rightTier) correctPairs += 1;
    }
  }
  return totalPairs === 0 ? 1 : correctPairs / totalPairs;
}

function boundaryIsAmbiguous(
  session: RankingSession,
  confidence: TopKConfidenceResult,
  k: number,
): boolean {
  if (k >= session.photoIds.length) return false;
  const ranked = rankPhotoIds(session.ratings);
  const insideId = ranked[k - 1];
  const outsideId = ranked[k];
  if (!insideId || !outsideId) return false;
  const inside = session.ratings[insideId];
  const outside = session.ratings[outsideId];
  if (!inside || !outside) return false;
  const posteriorDistance = Math.abs(inside.mu - outside.mu);
  const uncertaintyBand = (inside.sigma + outside.sigma) / 2;
  const insideProbability = confidence.inclusionProbabilities[insideId] ?? 0;
  const outsideProbability = confidence.inclusionProbabilities[outsideId] ?? 0;
  const probabilitiesAreAmbiguous = insideProbability < 0.8
    && insideProbability > 0.2
    && outsideProbability < 0.8
    && outsideProbability > 0.2;
  return posteriorDistance <= uncertaintyBand || probabilitiesAreAmbiguous;
}

function makeRecord(
  seed: number,
  decisionNumber: number,
  pair: Readonly<{ leftPhotoId: string; rightPhotoId: string }>,
  outcome: ComparisonOutcome,
): ComparisonRecord {
  return {
    id: `synthetic-${seed}-${decisionNumber}`,
    leftPhotoId: pair.leftPhotoId,
    rightPhotoId: pair.rightPhotoId,
    outcome,
    createdAt: decisionNumber,
  };
}

function runSession(
  fixture: RankingFixture,
  profile: HumanProfile,
  variant: BenchmarkVariant,
  repetition: number,
  seed: number,
  confidenceSamples: number,
): SessionResult {
  const pairSelection = buildPairSelectionParameters(variant);
  const ratingEngine = buildRatingEngine(variant);
  const selector = buildSelector(variant, pairSelection, ratingEngine);
  const confidenceEstimator = new MonteCarloTopKConfidenceEstimator(confidenceSamples);
  const simulator = new HumanDecisionSimulator(profile, fixture, createSeededRandom(seed));
  const legacyConfig = buildLegacyConfig(variant, pairSelection);
  const maximumDecisions = maximumFor(variant, fixture);
  let session = createRankingSession(fixture.photoIds, ratingEngine);
  let legacyStopState: StopRecommendationState = INITIAL_STOP_RECOMMENDATION_STATE;
  let expectedStopState: ExpectedOverlapStopState = INITIAL_EXPECTED_OVERLAP_STOP_STATE;
  let lastConfidence = confidenceEstimator.estimate(
    session,
    fixture.k,
    createSeededRandom(seed + 1),
  );
  let stopEvaluation: StopEvaluation | undefined;
  let decisionsPresented = 0;
  let informativeComparisons = 0;
  let simulatedHumanTimeMs = 0;
  let contradictoryChoices = 0;
  let repeatedPairDecisions = 0;
  let noPair = false;
  const outcomes = { left: 0, right: 0, draw: 0, skip: 0 };

  while (decisionsPresented < maximumDecisions) {
    const pair = selector.selectNextPair({ ...session, k: fixture.k });
    if (!pair) {
      noPair = true;
      break;
    }
    decisionsPresented += 1;
    const decision = simulator.choose(pair);
    simulatedHumanTimeMs += decision.responseTimeMs;
    if (decision.wasContradictory) contradictoryChoices += 1;
    if (decision.wasRepeatedPair) repeatedPairDecisions += 1;
    outcomes[decision.outcome.type] += 1;
    if (decision.outcome.type !== 'skip') informativeComparisons += 1;
    session = applyComparison(
      session,
      makeRecord(seed, decisionsPresented, pair, decision.outcome),
      ratingEngine,
    );
    lastConfidence = confidenceEstimator.estimate(
      session,
      fixture.k,
      createSeededRandom(seedFromDecision(seed, decisionsPresented)),
    );

    if (variant.stopPolicy === 'legacy-membership') {
      const evaluated = evaluateLegacyStop(
        session,
        lastConfidence,
        legacyStopState,
        legacyConfig,
      );
      legacyStopState = evaluated.state;
      stopEvaluation = {
        state: evaluated.state,
        recommendation: evaluated.recommendation,
      };
    } else if (variant.stopPolicy === 'production') {
      const evaluated = evaluateStopRecommendation(session, lastConfidence, legacyStopState, {
        ...legacyConfig,
        confidence: {
          ...legacyConfig.confidence,
          expectedOverlapEnterThreshold: variant.expectedOverlapEnterThreshold,
          expectedOverlapExitThreshold: variant.expectedOverlapExitThreshold,
          stableDecisionCount: variant.stableDecisionCount,
        },
      });
      legacyStopState = evaluated.state;
      stopEvaluation = evaluated;
    } else {
      const evaluated = evaluateExpectedOverlapStop(
        session,
        lastConfidence,
        expectedStopState,
        variant,
        fixture.k,
        maximumDecisions,
        decision.outcome.type !== 'skip',
        pairSelection.initialCoverageMatches,
      );
      expectedStopState = evaluated.state as ExpectedOverlapStopState;
      stopEvaluation = evaluated;
    }
    if (stopEvaluation.recommendation.isStable) break;
  }

  const producedTopK = getTopK(session, fixture.k);
  const frontierShortlist = rankPhotoIds(session.ratings).slice(
    0,
    Math.min(session.photoIds.length, fixture.k + 3),
  );
  const reachedMaximum = decisionsPresented >= maximumDecisions;
  const automaticallyStopped = stopEvaluation?.recommendation.isStable ?? false;
  const stopReason: SessionResult['stopReason'] = automaticallyStopped
    ? 'stable'
    : reachedMaximum || stopEvaluation?.recommendation.isMaximumReached ? 'maximum-reached'
    : noPair ? 'no-pair' : 'coverage-incomplete';
  const canonicalCorrectCount = countCorrect(producedTopK, fixture.targetTopK);
  const tierAwareTopKCorrectCount = countCorrect(producedTopK, fixture.acceptableTopKPhotoIds);
  const top3Size = Math.min(3, fixture.k);
  const top3Recall = tierAwareRecall(producedTopK, fixture, top3Size);
  const topKOverlap = canonicalCorrectCount / fixture.k;
  const tierAwareTopKOverlap = tierAwareTopKCorrectCount / fixture.k;
  const expectedTopKOverlapAtStop = lastConfidence.expectedTopKOverlap;

  return Object.freeze({
    fixtureId: fixture.id,
    variantId: variant.id,
    profileId: profile.id,
    repetition,
    seed,
    photoCount: fixture.photoIds.length,
    k: fixture.k,
    targetTopK: fixture.targetTopK,
    producedTopK,
    frontierShortlist: Object.freeze(frontierShortlist),
    frontierShortlistRecall: tierAwareRecall(frontierShortlist, fixture, fixture.k),
    decisionsPresented,
    informativeComparisons,
    outcomes: Object.freeze(outcomes),
    contradictoryChoices,
    repeatedPairDecisions,
    simulatedHumanTimeMs,
    expectedTopKOverlapAtStop,
    membershipStabilityAtStop: lastConfidence.membershipStability,
    orderStabilityAtStop: lastConfidence.orderStability,
    tierAwareTopKCorrectCount,
    canonicalTopKCorrectCount: canonicalCorrectCount,
    topKOverlap,
    tierAwareTopKOverlap,
    exactCanonicalTopK: canonicalCorrectCount === fixture.k,
    atLeastKMinusOneCorrect: tierAwareTopKCorrectCount >= Math.max(0, fixture.k - 1),
    top3Recall,
    tierTolerantOrderScore: tierTolerantOrderScore(producedTopK, fixture),
    calibrationError: Math.abs(expectedTopKOverlapAtStop - tierAwareTopKOverlap),
    signedCalibrationError: expectedTopKOverlapAtStop - tierAwareTopKOverlap,
    stopReason,
    automaticallyStopped,
    reachedMaximum,
    manualBoundaryResolutionRequired: variant.stopPolicy === 'production'
      ? stopEvaluation?.recommendation.requiresManualResolution ?? false
      : reachedMaximum && !automaticallyStopped && boundaryIsAmbiguous(session, lastConfidence, fixture.k),
    maxDecisionViolation: decisionsPresented > maximumDecisions,
    carousel: evaluateCarouselPolicies(session, fixture),
  });
}

function seedFromDecision(seed: number, decisionNumber: number): number {
  return (seed ^ Math.imul(decisionNumber + 1, 0x9E3779B9)) >>> 0;
}

function validatePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${label} must be a positive integer.`);
  return value;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function quantile(values: readonly number[], quantileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantileValue * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function stats(values: readonly number[]): SummaryStats {
  const sorted = [...values].sort((left, right) => left - right);
  return Object.freeze({
    mean: mean(values),
    median: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    minimum: sorted[0] ?? 0,
    maximum: sorted[sorted.length - 1] ?? 0,
  });
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function buildCalibrationBuckets(results: readonly SessionResult[]): readonly CalibrationBucket[] {
  const buckets = [
    { label: '<0.70', minimum: 0, maximum: 0.7 },
    { label: '0.70-0.80', minimum: 0.7, maximum: 0.8 },
    { label: '0.80-0.90', minimum: 0.8, maximum: 0.9 },
    { label: '>=0.90', minimum: 0.9, maximum: 1.01 },
  ];
  return Object.freeze(buckets.map(({ label, minimum, maximum }) => {
    const matching = results.filter(({ expectedTopKOverlapAtStop }) => (
      expectedTopKOverlapAtStop >= minimum && expectedTopKOverlapAtStop < maximum
    ));
    return Object.freeze({
      label,
      sessions: matching.length,
      meanDeclaredOverlap: mean(matching.map(({ expectedTopKOverlapAtStop }) => expectedTopKOverlapAtStop)),
      meanEmpiricalOverlap: mean(matching.map(({ tierAwareTopKOverlap }) => tierAwareTopKOverlap)),
    });
  }));
}

function aggregateCarousel(
  results: readonly SessionResult[],
  policy: CarouselPolicyId,
): CarouselAggregate {
  const evaluations = results.map(({ carousel }) => carousel[policy]);
  return Object.freeze({
    targetGroupRecall: stats(evaluations.map(({ targetGroupRecall }) => targetGroupRecall)),
    targetGroupPrecision: stats(evaluations.map(({ targetGroupPrecision }) => targetGroupPrecision)),
    uniqueGroupCount: stats(evaluations.map(({ uniqueGroupCount }) => uniqueGroupCount)),
    duplicateGroupSlots: stats(evaluations.map(({ duplicateGroupSlots }) => duplicateGroupSlots)),
    duplicateSelectionRate: rate(
      evaluations.filter(({ duplicateGroupSlots }) => duplicateGroupSlots > 0).length,
      evaluations.length,
    ),
    targetGroupSetExactRate: rate(
      evaluations.filter(({ targetGroupSetExact }) => targetGroupSetExact).length,
      evaluations.length,
    ),
    onePerGroupInvariantRate: rate(
      evaluations.filter(({ hasAtMostOnePhotoPerGroup }) => hasAtMostOnePhotoPerGroup).length,
      evaluations.length,
    ),
    expectedSizeInvariantRate: rate(
      evaluations.filter(({ hasExpectedSize }) => hasExpectedSize).length,
      evaluations.length,
    ),
  });
}

function aggregateResults(
  id: string,
  variantId: string,
  profileId: HumanProfile['id'] | undefined,
  results: readonly SessionResult[],
): AggregateMetrics {
  const totalDecisions = results.reduce((total, result) => total + result.decisionsPresented, 0);
  const totalOutcomes = results.reduce((total, result) => total + result.decisionsPresented, 0);
  const outcomeCounts = results.reduce((counts, result) => ({
    left: counts.left + result.outcomes.left,
    right: counts.right + result.outcomes.right,
    draw: counts.draw + result.outcomes.draw,
    skip: counts.skip + result.outcomes.skip,
  }), { left: 0, right: 0, draw: 0, skip: 0 });
  const metrics = Object.freeze({
    id,
    variantId,
    ...(profileId ? { profileId } : {}),
    sessions: results.length,
    photoCount: stats(results.map(({ photoCount }) => photoCount)),
    decisionsPresented: stats(results.map(({ decisionsPresented }) => decisionsPresented)),
    decisionsPerPhoto: stats(results.map(({ decisionsPresented, photoCount }) => decisionsPresented / photoCount)),
    informativeComparisons: stats(results.map(({ informativeComparisons }) => informativeComparisons)),
    simulatedHumanTimeSeconds: stats(results.map(({ simulatedHumanTimeMs }) => simulatedHumanTimeMs / 1_000)),
    topKOverlap: stats(results.map(({ topKOverlap }) => topKOverlap)),
    tierAwareTopKOverlap: stats(results.map(({ tierAwareTopKOverlap }) => tierAwareTopKOverlap)),
    exactCanonicalTopKRate: rate(results.filter(({ exactCanonicalTopK }) => exactCanonicalTopK).length, results.length),
    atLeastKMinusOneRate: rate(results.filter(({ atLeastKMinusOneCorrect }) => atLeastKMinusOneCorrect).length, results.length),
    top3Recall: stats(results.map(({ top3Recall }) => top3Recall)),
    frontierShortlistRecall: stats(results.map(({ frontierShortlistRecall }) => frontierShortlistRecall)),
    tierTolerantOrderScore: stats(results.map(({ tierTolerantOrderScore }) => tierTolerantOrderScore)),
    expectedTopKOverlapAtStop: stats(results.map(({ expectedTopKOverlapAtStop }) => expectedTopKOverlapAtStop)),
    meanAbsoluteCalibrationError: mean(results.map(({ calibrationError }) => calibrationError)),
    meanSignedCalibrationError: mean(results.map(({ signedCalibrationError }) => signedCalibrationError)),
    manualBoundaryResolutionRate: rate(
      results.filter(({ manualBoundaryResolutionRequired }) => manualBoundaryResolutionRequired).length,
      results.length,
    ),
    automaticallyStoppedRate: rate(results.filter(({ automaticallyStopped }) => automaticallyStopped).length, results.length),
    reachedMaximumRate: rate(results.filter(({ reachedMaximum }) => reachedMaximum).length, results.length),
    maxDecisionViolationCount: results.filter(({ maxDecisionViolation }) => maxDecisionViolation).length,
    contradictoryChoiceRate: rate(
      results.reduce((total, result) => total + result.contradictoryChoices, 0),
      totalDecisions,
    ),
    repeatedPairDecisionRate: rate(
      results.reduce((total, result) => total + result.repeatedPairDecisions, 0),
      totalDecisions,
    ),
    outcomeRates: Object.freeze({
      left: rate(outcomeCounts.left, totalOutcomes),
      right: rate(outcomeCounts.right, totalOutcomes),
      draw: rate(outcomeCounts.draw, totalOutcomes),
      skip: rate(outcomeCounts.skip, totalOutcomes),
    }),
    calibrationBuckets: buildCalibrationBuckets(results),
    carousel: Object.freeze({
      'top-k': aggregateCarousel(results, 'top-k'),
      'group-diverse-reference': aggregateCarousel(results, 'group-diverse-reference'),
    }),
  });
  return metrics;
}

function dominates(left: AggregateMetrics, right: AggregateMetrics): boolean {
  const noWorse = left.tierAwareTopKOverlap.mean >= right.tierAwareTopKOverlap.mean
    && left.top3Recall.mean >= right.top3Recall.mean
    && left.decisionsPerPhoto.median <= right.decisionsPerPhoto.median
    && left.decisionsPerPhoto.p90 <= right.decisionsPerPhoto.p90;
  const strictlyBetter = left.tierAwareTopKOverlap.mean > right.tierAwareTopKOverlap.mean
    || left.top3Recall.mean > right.top3Recall.mean
    || left.decisionsPerPhoto.median < right.decisionsPerPhoto.median
    || left.decisionsPerPhoto.p90 < right.decisionsPerPhoto.p90;
  return noWorse && strictlyBetter;
}

function buildGateEvaluation(aggregate: AggregateMetrics): GateEvaluation {
  const evaluation = {
    variantId: aggregate.variantId,
    expectedOverlapAtLeastPointNine: aggregate.tierAwareTopKOverlap.mean >= 0.9,
    atLeastKMinusOneAtLeast95Percent: aggregate.atLeastKMinusOneRate >= 0.95,
    top3RecallAtLeast95Percent: aggregate.top3Recall.mean >= 0.95,
    medianDecisionsPerPhotoAtMostOnePointTwentyFive: aggregate.decisionsPerPhoto.median <= 1.25,
    p90DecisionsPerPhotoAtMostOnePointSeventyFive: aggregate.decisionsPerPhoto.p90 <= 1.75,
    noMaximumDecisionViolations: aggregate.maxDecisionViolationCount === 0,
  };
  return Object.freeze({
    ...evaluation,
    allHypothesesPassed: Object.values(evaluation).every((value) => typeof value !== 'boolean' || value),
  });
}

function buildParetoFrontier(aggregates: readonly AggregateMetrics[]): readonly string[] {
  return Object.freeze(aggregates
    .filter((candidate) => !aggregates.some((other) => other.variantId !== candidate.variantId && dominates(other, candidate)))
    .map(({ variantId }) => variantId));
}

export function runBenchmark(options: BenchmarkOptions = {}): BenchmarkReport {
  const sessionsPerScenario = validatePositiveInteger(options.sessionsPerScenario ?? 8, 'sessionsPerScenario');
  const confidenceSamples = validatePositiveInteger(options.confidenceSamples ?? 500, 'confidenceSamples');
  const fixtures = options.fixtures ?? SYNTHETIC_FIXTURES;
  const profiles = options.profiles ?? HUMAN_PROFILES;
  const variants = options.variants ?? BENCHMARK_VARIANTS;
  if (fixtures.length === 0 || profiles.length === 0 || variants.length === 0) {
    throw new RangeError('The benchmark requires at least one fixture, profile and variant.');
  }

  const sessions: SessionResult[] = [];
  for (const variant of variants) {
    for (const profile of profiles) {
      for (const fixture of fixtures) {
        for (let repetition = 0; repetition < sessionsPerScenario; repetition += 1) {
          const seed = seedForScenario(fixture.id, profile.id, repetition);
          sessions.push(runSession(fixture, profile, variant, repetition, seed, confidenceSamples));
        }
      }
    }
  }
  const byVariant = variants.map((variant) => aggregateResults(
    variant.id,
    variant.id,
    undefined,
    sessions.filter(({ variantId }) => variantId === variant.id),
  ));
  const byVariantAndProfile = variants.flatMap((variant) => profiles.map((profile) => aggregateResults(
    `${variant.id}:${profile.id}`,
    variant.id,
    profile.id,
    sessions.filter(({ variantId, profileId }) => variantId === variant.id && profileId === profile.id),
  )));
  const aggregates = Object.freeze([...byVariant, ...byVariantAndProfile]);

  return Object.freeze({
    schemaVersion: 1,
    description: 'Benchmark sintético de PhotoRank: nombres ficticios, tiers de preferencia y grupos declarados; no carga fotos.',
    settings: Object.freeze({
      sessionsPerScenario,
      confidenceSamples,
      fixtureIds: Object.freeze(fixtures.map(({ id }) => id)),
      fixtureDefinitions: Object.freeze(fixtures.map(({ id, k, tiers, groups }) => Object.freeze({ id, k, tiers, groups }))),
      profileIds: Object.freeze(profiles.map(({ id }) => id)),
      profileDefinitions: Object.freeze(profiles),
      variantIds: Object.freeze(variants.map(({ id }) => id)),
      variantDefinitions: Object.freeze(variants),
    }),
    sessions: Object.freeze(sessions),
    aggregates,
    gateEvaluations: Object.freeze(byVariant.map(buildGateEvaluation)),
    paretoFrontierVariantIds: buildParetoFrontier(byVariant),
  });
}

function seedForScenario(
  fixtureId: string,
  profileId: string,
  repetition: number,
): number {
  let hash = 2_166_136_261;
  const value = `${fixtureId}|${profileId}|${repetition}`;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatSummary(report: BenchmarkReport): string {
  const lines = [
    'PhotoRank — benchmark sintético de Top K y diversidad de carrusel',
    `Escenarios: ${report.sessions.length} sesiones · ${report.settings.confidenceSamples} muestras Monte Carlo por decisión`,
    'Las fotos son solo ids ficticios. Las métricas de tiempo son un modelo configurable de interacción, no cronometraje humano real.',
    '',
    'Variante                         overlap  recall@3  shortlist  mediana dec/N  p90 dec/N  mediana s  manual  gates',
  ];
  for (const aggregate of report.aggregates.filter(({ profileId }) => profileId === undefined)) {
    const gate = report.gateEvaluations.find(({ variantId }) => variantId === aggregate.variantId);
    lines.push([
      aggregate.variantId.padEnd(32),
      formatPercentage(aggregate.tierAwareTopKOverlap.mean).padStart(7),
      formatPercentage(aggregate.top3Recall.mean).padStart(9),
      formatPercentage(aggregate.frontierShortlistRecall.mean).padStart(9),
      aggregate.decisionsPerPhoto.median.toFixed(2).padStart(14),
      aggregate.decisionsPerPhoto.p90.toFixed(2).padStart(10),
      aggregate.simulatedHumanTimeSeconds.median.toFixed(1).padStart(9),
      formatPercentage(aggregate.manualBoundaryResolutionRate).padStart(7),
      gate?.allHypothesesPassed ? 'PASS' : 'revisar',
    ].join('  '));
  }
  lines.push('', `Frontera Pareto observada: ${report.paretoFrontierVariantIds.join(', ') || 'ninguna'}`);
  lines.push('Carrusel: comparar top-k (baseline redundante) con group-diverse-reference (contrato previo a MMR).');
  return `${lines.join('\n')}\n`;
}
