import {
  createSeededRandom,
  MonteCarloTopKConfidenceEstimator,
  seedFromText,
} from '../confidence';
import type { PhotoId } from '../contracts';
import { DEFAULT_RANKING_CONFIG } from '../ranking-config';
import type { PairSelectionParameters } from '../ranking-config';
import {
  getTopK,
  type RatingEngine,
  type ComparisonOutcome,
  type PhotoRating,
  type RatedComparisonOutcome,
  type RankingSession,
} from '../rating';
import { AdaptivePairSelectionEngine } from './adaptive-pair-selection-engine';
import type { PairSelectionContext, PairSelectionEngine, SelectedPair } from './types';

export interface TopKInformationGainParameters {
  readonly posteriorSamples: number;
  readonly candidatePoolSize: number;
  readonly minimumInclusionProbability: number;
  readonly repeatPenalty: number;
  readonly lowExposureBonus: number;
}

export const DEFAULT_TOP_K_INFORMATION_GAIN_PARAMETERS: TopKInformationGainParameters = Object.freeze({
  posteriorSamples: 128,
  candidatePoolSize: 8,
  minimumInclusionProbability: 0.025,
  repeatPenalty: 0.015,
  lowExposureBonus: 0.01,
});

interface PairHistory {
  readonly count: number;
  readonly lastShownIndex: number;
  readonly lastSkipIndex: number;
}

interface CandidatePair {
  readonly firstPhotoId: PhotoId;
  readonly secondPhotoId: PhotoId;
  readonly history: PairHistory;
}

interface ScoredPair extends CandidatePair {
  readonly leftPhotoId: PhotoId;
  readonly rightPhotoId: PhotoId;
  readonly informationGain: number;
  readonly score: number;
}

const EMPTY_PAIR_HISTORY: PairHistory = Object.freeze({
  count: 0,
  lastShownIndex: Number.NEGATIVE_INFINITY,
  lastSkipIndex: Number.NEGATIVE_INFINITY,
});

const RATED_OUTCOMES: readonly RatedComparisonOutcome[] = Object.freeze([
  Object.freeze({ type: 'left' }),
  Object.freeze({ type: 'right' }),
  Object.freeze({ type: 'draw' }),
]);

function pairKey(firstPhotoId: PhotoId, secondPhotoId: PhotoId): string {
  return [firstPhotoId, secondPhotoId].sort((left, right) => left.localeCompare(right)).join('\u0001');
}

function ratingFor(context: PairSelectionContext, photoId: PhotoId): PhotoRating {
  const rating = context.ratings[photoId];
  if (!rating) throw new Error(`Missing rating for photo: ${photoId}`);
  return rating;
}

function validateParameters(parameters: TopKInformationGainParameters): void {
  if (!Number.isInteger(parameters.posteriorSamples) || parameters.posteriorSamples < 16) {
    throw new RangeError('Information-gain posteriorSamples must be an integer of at least 16.');
  }
  if (!Number.isInteger(parameters.candidatePoolSize) || parameters.candidatePoolSize < 1) {
    throw new RangeError('Information-gain candidatePoolSize must be a positive integer.');
  }
  if (parameters.minimumInclusionProbability < 0 || parameters.minimumInclusionProbability >= 0.5) {
    throw new RangeError('Information-gain minimumInclusionProbability must be in [0, 0.5).');
  }
  if (parameters.repeatPenalty < 0 || parameters.lowExposureBonus < 0) {
    throw new RangeError('Information-gain penalties and bonuses cannot be negative.');
  }
}

function buildPairHistory(context: PairSelectionContext): ReadonlyMap<string, PairHistory> {
  const result = new Map<string, PairHistory>();
  context.history.forEach((record, index) => {
    const key = pairKey(record.leftPhotoId, record.rightPhotoId);
    const previous = result.get(key) ?? EMPTY_PAIR_HISTORY;
    result.set(key, Object.freeze({
      count: previous.count + 1,
      lastShownIndex: index,
      lastSkipIndex: record.outcome.type === 'skip' ? index : previous.lastSkipIndex,
    }));
  });
  return result;
}

function buildCandidates(
  photoIds: readonly PhotoId[],
  historyByPair: ReadonlyMap<string, PairHistory>,
): readonly CandidatePair[] {
  const sortedIds = [...photoIds].sort((left, right) => left.localeCompare(right));
  const candidates: CandidatePair[] = [];
  for (let firstIndex = 0; firstIndex < sortedIds.length; firstIndex += 1) {
    const firstPhotoId = sortedIds[firstIndex];
    if (!firstPhotoId) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < sortedIds.length; secondIndex += 1) {
      const secondPhotoId = sortedIds[secondIndex];
      if (!secondPhotoId) continue;
      candidates.push(Object.freeze({
        firstPhotoId,
        secondPhotoId,
        history: historyByPair.get(pairKey(firstPhotoId, secondPhotoId)) ?? EMPTY_PAIR_HISTORY,
      }));
    }
  }
  return candidates;
}

function applyCooldowns(
  candidates: readonly CandidatePair[],
  historyLength: number,
  parameters: PairSelectionParameters,
): readonly CandidatePair[] {
  const outsideSkipCooldown = candidates.filter(({ history }) => (
    historyLength - 1 - history.lastSkipIndex >= parameters.skipCooldownDecisions
  ));
  const skipEligible = outsideSkipCooldown.length > 0 ? outsideSkipCooldown : candidates;
  const outsideRepeatCooldown = skipEligible.filter(({ history }) => (
    historyLength - 1 - history.lastShownIndex >= parameters.repeatCooldownDecisions
  ));
  return outsideRepeatCooldown.length > 0 ? outsideRepeatCooldown : skipEligible;
}

function binaryEntropy(probability: number): number {
  if (probability <= 0 || probability >= 1) return 0;
  return -probability * Math.log2(probability)
    - (1 - probability) * Math.log2(1 - probability);
}

function membershipEntropy(probabilities: Readonly<Record<PhotoId, number>>, photoIds: readonly PhotoId[]): number {
  return photoIds.reduce(
    (total, photoId) => total + binaryEntropy(probabilities[photoId] ?? 0),
    0,
  ) / photoIds.length;
}

function normalCdf(value: number): number {
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.2316419 * absolute);
  const density = 0.3989422804014327 * Math.exp(-(absolute * absolute) / 2);
  const polynomial = t * (
    0.319381530
    + t * (-0.356563782
      + t * (1.781477937
        + t * (-1.821255978 + t * 1.330274429)))
  );
  const positiveCdf = 1 - density * polynomial;
  return value >= 0 ? positiveCdf : 1 - positiveCdf;
}

// Acklam's rational approximation, sufficient for the fixed TrueSkill draw margin.
function inverseNormalCdf(probability: number): number {
  if (probability <= 0 || probability >= 1) {
    throw new RangeError('inverseNormalCdf requires a probability strictly between zero and one.');
  }
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  const high = 1 - low;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!)
      / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!)
      / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q
    / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

function outcomeProbabilities(
  left: PhotoRating,
  right: PhotoRating,
  ratingEngine: RatingEngine,
): Readonly<Record<'left' | 'right' | 'draw', number>> {
  const { beta, drawProbability } = ratingEngine.parameters;
  const drawMargin = inverseNormalCdf((drawProbability + 1) / 2) * Math.sqrt(2) * beta;
  const differenceMean = left.mu - right.mu;
  const differenceDeviation = Math.sqrt(
    left.sigma * left.sigma + right.sigma * right.sigma + 2 * beta * beta,
  );
  const rightProbability = normalCdf((-drawMargin - differenceMean) / differenceDeviation);
  const leftProbability = 1 - normalCdf((drawMargin - differenceMean) / differenceDeviation);
  const draw = Math.max(0, 1 - leftProbability - rightProbability);
  const total = leftProbability + rightProbability + draw;
  return Object.freeze({
    left: leftProbability / total,
    right: rightProbability / total,
    draw: draw / total,
  });
}

function hypotheticalSession(
  context: PairSelectionContext,
  firstPhotoId: PhotoId,
  secondPhotoId: PhotoId,
  outcome: ComparisonOutcome,
  ratingEngine: RatingEngine,
): RankingSession {
  const updated = ratingEngine.rate(
    ratingFor(context, firstPhotoId),
    ratingFor(context, secondPhotoId),
    outcome,
  );
  return Object.freeze({
    photoIds: context.photoIds,
    history: context.history,
    ratings: Object.freeze({
      ...context.ratings,
      [firstPhotoId]: updated.left,
      [secondPhotoId]: updated.right,
    }),
  });
}

function seedForContext(context: PairSelectionContext): number {
  return seedFromText([
    context.k,
    ...[...context.photoIds].sort((left, right) => left.localeCompare(right)),
    ...context.history.map((record) => (
      `${record.leftPhotoId}:${record.rightPhotoId}:${record.outcome.type}`
    )),
  ].join('|'));
}

function inclusionCandidateIds(
  context: PairSelectionContext,
  probabilities: Readonly<Record<PhotoId, number>>,
  parameters: TopKInformationGainParameters,
): ReadonlySet<PhotoId> {
  const currentTopK = new Set(getTopK(context as RankingSession, context.k));
  const inside = context.photoIds
    .filter((photoId) => currentTopK.has(photoId))
    .sort((left, right) => (
      (probabilities[left] ?? 0) - (probabilities[right] ?? 0)
      || left.localeCompare(right)
    ));
  const outside = context.photoIds
    .filter((photoId) => !currentTopK.has(photoId))
    .sort((left, right) => (
      (probabilities[right] ?? 0) - (probabilities[left] ?? 0)
      || left.localeCompare(right)
    ));
  const selected = [
    ...inside.slice(0, Math.min(parameters.candidatePoolSize, inside.length)),
    ...outside
      .filter((photoId) => (probabilities[photoId] ?? 0) >= parameters.minimumInclusionProbability)
      .slice(0, parameters.candidatePoolSize),
  ];
  return new Set(selected.length >= 2 ? selected : [...inside, ...outside].slice(0, 2));
}

function sideCounts(context: PairSelectionContext, photoId: PhotoId): Readonly<{ left: number; right: number }> {
  return context.history.reduce((counts, record) => ({
    left: counts.left + (record.leftPhotoId === photoId ? 1 : 0),
    right: counts.right + (record.rightPhotoId === photoId ? 1 : 0),
  }), { left: 0, right: 0 });
}

function orientPair(
  context: PairSelectionContext,
  candidate: CandidatePair,
): Readonly<{ leftPhotoId: PhotoId; rightPhotoId: PhotoId }> {
  const first = sideCounts(context, candidate.firstPhotoId);
  const second = sideCounts(context, candidate.secondPhotoId);
  const forwardImbalance = Math.abs(first.left + 1 - first.right)
    + Math.abs(second.left - second.right - 1);
  const reverseImbalance = Math.abs(second.left + 1 - second.right)
    + Math.abs(first.left - first.right - 1);
  return reverseImbalance < forwardImbalance
    ? Object.freeze({ leftPhotoId: candidate.secondPhotoId, rightPhotoId: candidate.firstPhotoId })
    : Object.freeze({ leftPhotoId: candidate.firstPhotoId, rightPhotoId: candidate.secondPhotoId });
}

export class TopKInformationGainPairSelectionEngine implements PairSelectionEngine {
  private readonly parameters: TopKInformationGainParameters;
  private readonly coverageSelector: AdaptivePairSelectionEngine;
  private readonly estimator: MonteCarloTopKConfidenceEstimator;

  constructor(
    private readonly ratingEngine: RatingEngine,
    parameters: TopKInformationGainParameters = DEFAULT_TOP_K_INFORMATION_GAIN_PARAMETERS,
    pairSelectionParameters: PairSelectionParameters = DEFAULT_RANKING_CONFIG.pairSelection,
  ) {
    validateParameters(parameters);
    this.parameters = Object.freeze({ ...parameters });
    this.coverageSelector = new AdaptivePairSelectionEngine(Object.freeze({
      ...pairSelectionParameters,
      initialCoverageMatches: 1,
    }));
    this.estimator = new MonteCarloTopKConfidenceEstimator(parameters.posteriorSamples);
  }

  selectNextPair(context: PairSelectionContext): SelectedPair | undefined {
    if (context.photoIds.length < 2) return undefined;
    if (context.photoIds.some((photoId) => ratingFor(context, photoId).matches < 1)) {
      return this.coverageSelector.selectNextPair(context);
    }
    if (context.k === context.photoIds.length) {
      return this.coverageSelector.selectNextPair(context);
    }

    const seed = seedForContext(context);
    const currentConfidence = this.estimator.estimate(
      context as RankingSession,
      context.k,
      createSeededRandom(seed),
    );
    const currentEntropy = membershipEntropy(currentConfidence.inclusionProbabilities, context.photoIds);
    const candidateIds = inclusionCandidateIds(
      context,
      currentConfidence.inclusionProbabilities,
      this.parameters,
    );
    const historyByPair = buildPairHistory(context);
    let candidates: readonly CandidatePair[] = buildCandidates(context.photoIds, historyByPair).filter(({ firstPhotoId, secondPhotoId }) => (
      candidateIds.has(firstPhotoId) && candidateIds.has(secondPhotoId)
    ));
    candidates = applyCooldowns(candidates, context.history.length, DEFAULT_RANKING_CONFIG.pairSelection);

    const scored = candidates.map((candidate): ScoredPair => {
      const probabilities = outcomeProbabilities(
        ratingFor(context, candidate.firstPhotoId),
        ratingFor(context, candidate.secondPhotoId),
        this.ratingEngine,
      );
      const expectedPosteriorEntropy = RATED_OUTCOMES.reduce((total, outcome) => {
        const posterior = hypotheticalSession(
          context,
          candidate.firstPhotoId,
          candidate.secondPhotoId,
          outcome,
          this.ratingEngine,
        );
        const confidence = this.estimator.estimate(
          posterior,
          context.k,
          createSeededRandom(seed),
        );
        return total + probabilities[outcome.type] * membershipEntropy(
          confidence.inclusionProbabilities,
          context.photoIds,
        );
      }, 0);
      const informationGain = currentEntropy - expectedPosteriorEntropy;
      const first = ratingFor(context, candidate.firstPhotoId);
      const second = ratingFor(context, candidate.secondPhotoId);
      const lowExposure = 1 / (1 + first.matches + second.matches);
      const orientation = orientPair(context, candidate);
      return Object.freeze({
        ...candidate,
        ...orientation,
        informationGain,
        score: informationGain
          + this.parameters.lowExposureBonus * lowExposure
          - this.parameters.repeatPenalty * candidate.history.count,
      });
    }).sort((left, right) => (
      right.score - left.score
      || right.informationGain - left.informationGain
      || left.firstPhotoId.localeCompare(right.firstPhotoId)
      || left.secondPhotoId.localeCompare(right.secondPhotoId)
    ));

    const selected = scored[0];
    if (!selected) return this.coverageSelector.selectNextPair(context);
    return Object.freeze({
      leftPhotoId: selected.leftPhotoId,
      rightPhotoId: selected.rightPhotoId,
      stage: 'adaptive',
    });
  }
}
