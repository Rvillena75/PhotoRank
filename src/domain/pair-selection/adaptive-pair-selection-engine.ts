import type { PhotoId } from '../contracts';
import { DEFAULT_RANKING_CONFIG } from '../ranking-config';
import type { PairSelectionParameters } from '../ranking-config';
import { rankPhotoIds } from '../rating';
import type { ComparisonRecord, PhotoRating } from '../rating';
import type { PairSelectionContext, PairSelectionEngine, SelectedPair } from './types';

interface SideCounts {
  left: number;
  right: number;
}

interface PairHistory {
  count: number;
  lastShownIndex: number;
  lastSkipIndex: number;
}

interface CandidatePair {
  firstPhotoId: PhotoId;
  secondPhotoId: PhotoId;
  history: PairHistory;
}

interface ScoredPair extends CandidatePair {
  leftPhotoId: PhotoId;
  rightPhotoId: PhotoId;
  score: number;
}

const EMPTY_PAIR_HISTORY: PairHistory = Object.freeze({
  count: 0,
  lastShownIndex: Number.NEGATIVE_INFINITY,
  lastSkipIndex: Number.NEGATIVE_INFINITY,
});

function pairKey(leftPhotoId: PhotoId, rightPhotoId: PhotoId): string {
  return JSON.stringify([leftPhotoId, rightPhotoId].sort((left, right) => left.localeCompare(right)));
}

function ratingFor(context: PairSelectionContext, photoId: PhotoId): PhotoRating {
  const rating = context.ratings[photoId];
  if (!rating) throw new Error(`Missing rating for photo: ${photoId}`);
  return rating;
}

function validateContext(context: PairSelectionContext): void {
  if (new Set(context.photoIds).size !== context.photoIds.length) {
    throw new Error('Pair selection requires unique photo ids.');
  }
  if (!Number.isInteger(context.k) || context.k < 1 || context.k > context.photoIds.length) {
    throw new RangeError(`K must be an integer between 1 and ${context.photoIds.length}.`);
  }
  for (const photoId of context.photoIds) ratingFor(context, photoId);
}

function buildPairHistory(history: readonly ComparisonRecord[]): ReadonlyMap<string, PairHistory> {
  const byPair = new Map<string, PairHistory>();
  history.forEach((record, index) => {
    const key = pairKey(record.leftPhotoId, record.rightPhotoId);
    const previous = byPair.get(key) ?? EMPTY_PAIR_HISTORY;
    byPair.set(key, {
      count: previous.count + 1,
      lastShownIndex: index,
      lastSkipIndex: record.outcome.type === 'skip' ? index : previous.lastSkipIndex,
    });
  });
  return byPair;
}

function buildSideCounts(
  photoIds: readonly PhotoId[],
  history: readonly ComparisonRecord[],
): ReadonlyMap<PhotoId, SideCounts> {
  const counts = new Map<PhotoId, SideCounts>(
    photoIds.map((photoId): [PhotoId, SideCounts] => [photoId, { left: 0, right: 0 }]),
  );
  for (const record of history) {
    const left = counts.get(record.leftPhotoId);
    const right = counts.get(record.rightPhotoId);
    if (left) left.left += 1;
    if (right) right.right += 1;
  }
  return counts;
}

function allCandidatePairs(
  photoIds: readonly PhotoId[],
  historyByPair: ReadonlyMap<string, PairHistory>,
): readonly CandidatePair[] {
  const sortedIds = [...photoIds].sort((left, right) => left.localeCompare(right));
  const candidates: CandidatePair[] = [];
  for (let firstIndex = 0; firstIndex < sortedIds.length; firstIndex += 1) {
    const firstPhotoId = sortedIds[firstIndex];
    if (firstPhotoId === undefined) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < sortedIds.length; secondIndex += 1) {
      const secondPhotoId = sortedIds[secondIndex];
      if (secondPhotoId === undefined) continue;
      candidates.push({
        firstPhotoId,
        secondPhotoId,
        history: historyByPair.get(pairKey(firstPhotoId, secondPhotoId)) ?? EMPTY_PAIR_HISTORY,
      });
    }
  }
  return candidates;
}

function preferAvailablePairs(
  candidates: readonly CandidatePair[],
  historyLength: number,
  parameters: PairSelectionParameters,
): readonly CandidatePair[] {
  const outsideSkipCooldown = candidates.filter(
    ({ history }) => historyLength - 1 - history.lastSkipIndex >= parameters.skipCooldownDecisions,
  );
  const skipEligible = outsideSkipCooldown.length > 0 ? outsideSkipCooldown : candidates;
  const outsideRepeatCooldown = skipEligible.filter(
    ({ history }) => historyLength - 1 - history.lastShownIndex >= parameters.repeatCooldownDecisions,
  );
  return outsideRepeatCooldown.length > 0 ? outsideRepeatCooldown : skipEligible;
}

function sideImbalanceAfter(
  leftPhotoId: PhotoId,
  rightPhotoId: PhotoId,
  counts: ReadonlyMap<PhotoId, SideCounts>,
): number {
  const left = counts.get(leftPhotoId) ?? { left: 0, right: 0 };
  const right = counts.get(rightPhotoId) ?? { left: 0, right: 0 };
  return Math.abs(left.left + 1 - left.right) + Math.abs(right.left - (right.right + 1));
}

function orientPair(
  candidate: CandidatePair,
  sideCounts: ReadonlyMap<PhotoId, SideCounts>,
): Readonly<{ leftPhotoId: PhotoId; rightPhotoId: PhotoId; imbalance: number }> {
  const forwardImbalance = sideImbalanceAfter(candidate.firstPhotoId, candidate.secondPhotoId, sideCounts);
  const reverseImbalance = sideImbalanceAfter(candidate.secondPhotoId, candidate.firstPhotoId, sideCounts);
  if (reverseImbalance < forwardImbalance) {
    return { leftPhotoId: candidate.secondPhotoId, rightPhotoId: candidate.firstPhotoId, imbalance: reverseImbalance };
  }
  return { leftPhotoId: candidate.firstPhotoId, rightPhotoId: candidate.secondPhotoId, imbalance: forwardImbalance };
}

function coverageScore(
  candidate: CandidatePair,
  context: PairSelectionContext,
  parameters: PairSelectionParameters,
): number {
  const first = ratingFor(context, candidate.firstPhotoId);
  const second = ratingFor(context, candidate.secondPhotoId);
  const firstDeficit = Math.max(0, parameters.initialCoverageMatches - first.matches);
  const secondDeficit = Math.max(0, parameters.initialCoverageMatches - second.matches);
  const bothNeedCoverage = firstDeficit > 0 && secondDeficit > 0;
  return parameters.coverageDeficitWeight * (firstDeficit + secondDeficit)
    + (bothNeedCoverage ? parameters.doubleCoverageBonus : 0)
    + (candidate.history.count === 0 ? parameters.unseenPairBonus : 0)
    - parameters.repeatedPairPenalty * candidate.history.count;
}

function adaptiveScore(
  candidate: CandidatePair,
  context: PairSelectionContext,
  rankIndexes: ReadonlyMap<PhotoId, number>,
  uncertaintyScale: number,
  parameters: PairSelectionParameters,
): number {
  const first = ratingFor(context, candidate.firstPhotoId);
  const second = ratingFor(context, candidate.secondPhotoId);
  const uncertainty = (first.sigma + second.sigma) / (2 * uncertaintyScale);
  const ratingProximity = 1 / (1 + Math.abs(first.mu - second.mu) / uncertaintyScale);
  const firstRank = rankIndexes.get(candidate.firstPhotoId) ?? 0;
  const secondRank = rankIndexes.get(candidate.secondPhotoId) ?? 0;
  const hasMembershipFrontier = context.k < context.photoIds.length;
  const boundary = context.k - 0.5;
  const frontierProximity = hasMembershipFrontier
    ? (1 / (1 + Math.abs(firstRank - boundary)) + 1 / (1 + Math.abs(secondRank - boundary))) / 2
    : 0;
  const crossesFrontier = hasMembershipFrontier
    && ((firstRank < context.k && secondRank >= context.k) || (secondRank < context.k && firstRank >= context.k));
  const lowExposure = 1 / (1 + first.matches + second.matches);

  return parameters.uncertaintyWeight * uncertainty
    + parameters.ratingProximityWeight * ratingProximity
    + parameters.frontierWeight * frontierProximity
    + (crossesFrontier ? parameters.frontierCrossingBonus : 0)
    + parameters.lowExposureWeight * lowExposure
    + (candidate.history.count === 0 ? parameters.unseenPairBonus : 0)
    - parameters.repeatedPairPenalty * candidate.history.count;
}

function stableScoreOrder(left: ScoredPair, right: ScoredPair): number {
  const scoreDifference = right.score - left.score;
  if (scoreDifference !== 0) return scoreDifference;
  const firstDifference = left.firstPhotoId.localeCompare(right.firstPhotoId);
  return firstDifference === 0 ? left.secondPhotoId.localeCompare(right.secondPhotoId) : firstDifference;
}

export class AdaptivePairSelectionEngine implements PairSelectionEngine {
  private readonly parameters: PairSelectionParameters;

  constructor(parameters: PairSelectionParameters = DEFAULT_RANKING_CONFIG.pairSelection) {
    this.parameters = Object.freeze({ ...parameters });
  }

  selectNextPair(context: PairSelectionContext): SelectedPair | undefined {
    validateContext(context);
    if (context.photoIds.length < 2) return undefined;

    const isCoverageStage = context.photoIds.some(
      (photoId) => ratingFor(context, photoId).matches < this.parameters.initialCoverageMatches,
    );
    const historyByPair = buildPairHistory(context.history);
    const sideCounts = buildSideCounts(context.photoIds, context.history);
    let candidates = allCandidatePairs(context.photoIds, historyByPair);

    if (isCoverageStage) {
      candidates = candidates.filter(({ firstPhotoId, secondPhotoId }) =>
        ratingFor(context, firstPhotoId).matches < this.parameters.initialCoverageMatches
        || ratingFor(context, secondPhotoId).matches < this.parameters.initialCoverageMatches);
    }
    candidates = preferAvailablePairs(candidates, context.history.length, this.parameters);

    const rankIndexes = new Map(rankPhotoIds(context.ratings).map((photoId, index) => [photoId, index] as const));
    const uncertaintyScale = Math.max(
      ...context.photoIds.map((photoId) => ratingFor(context, photoId).sigma),
      Number.EPSILON,
    );
    const scored = candidates.map((candidate): ScoredPair => {
      const orientation = orientPair(candidate, sideCounts);
      const baseScore = isCoverageStage
        ? coverageScore(candidate, context, this.parameters)
        : adaptiveScore(candidate, context, rankIndexes, uncertaintyScale, this.parameters);
      const recentlyShown = context.history.length - 1 - candidate.history.lastShownIndex < this.parameters.repeatCooldownDecisions;
      const recentlySkipped = context.history.length - 1 - candidate.history.lastSkipIndex < this.parameters.skipCooldownDecisions;
      return {
        ...candidate,
        ...orientation,
        score: baseScore
          - this.parameters.sideImbalancePenalty * orientation.imbalance
          - (recentlyShown ? this.parameters.recentPairPenalty : 0)
          - (recentlySkipped ? this.parameters.skippedPairPenalty : 0),
      };
    }).sort(stableScoreOrder);

    const selected = scored[0];
    if (!selected) return undefined;
    return Object.freeze({
      leftPhotoId: selected.leftPhotoId,
      rightPhotoId: selected.rightPhotoId,
      stage: isCoverageStage ? 'coverage' : 'adaptive',
    });
  }
}
