import type { PhotoId } from '../contracts';
import { DEFAULT_RANKING_CONFIG } from '../ranking-config';
import type { PairSelectionParameters } from '../ranking-config';
import type { ComparisonRecord, PhotoRating } from '../rating';
import { AdaptivePairSelectionEngine } from './adaptive-pair-selection-engine';
import type { PairSelectionContext, PairSelectionEngine, SelectedPair } from './types';

export interface BalancedEvidenceParameters {
  readonly evidenceMatchesPerPhoto: number;
  readonly proximityWeight: number;
  readonly unseenPairBonus: number;
  readonly repeatedPairPenalty: number;
}

export const DEFAULT_BALANCED_EVIDENCE_PARAMETERS: BalancedEvidenceParameters = Object.freeze({
  evidenceMatchesPerPhoto: 3,
  proximityWeight: 2,
  unseenPairBonus: 1,
  repeatedPairPenalty: 2,
});

interface Candidate {
  readonly firstPhotoId: PhotoId;
  readonly secondPhotoId: PhotoId;
  readonly pairCount: number;
  readonly lastShownIndex: number;
  readonly score: number;
}

function pairKey(firstPhotoId: PhotoId, secondPhotoId: PhotoId): string {
  return [firstPhotoId, secondPhotoId].sort((left, right) => left.localeCompare(right)).join('\u0001');
}

function ratingFor(context: PairSelectionContext, photoId: PhotoId): PhotoRating {
  const rating = context.ratings[photoId];
  if (!rating) throw new Error(`Missing rating for photo: ${photoId}`);
  return rating;
}

function pairHistory(history: readonly ComparisonRecord[]): ReadonlyMap<string, Readonly<{
  count: number;
  lastShownIndex: number;
}>> {
  const result = new Map<string, { count: number; lastShownIndex: number }>();
  history.forEach((record, index) => {
    const key = pairKey(record.leftPhotoId, record.rightPhotoId);
    const previous = result.get(key);
    result.set(key, { count: (previous?.count ?? 0) + 1, lastShownIndex: index });
  });
  return result;
}

function sideCount(history: readonly ComparisonRecord[], photoId: PhotoId, side: 'left' | 'right'): number {
  return history.filter((record) => record[side === 'left' ? 'leftPhotoId' : 'rightPhotoId'] === photoId).length;
}

function orient(
  context: PairSelectionContext,
  firstPhotoId: PhotoId,
  secondPhotoId: PhotoId,
): Readonly<{ leftPhotoId: PhotoId; rightPhotoId: PhotoId }> {
  const firstLeft = sideCount(context.history, firstPhotoId, 'left');
  const firstRight = sideCount(context.history, firstPhotoId, 'right');
  const secondLeft = sideCount(context.history, secondPhotoId, 'left');
  const secondRight = sideCount(context.history, secondPhotoId, 'right');
  const forward = Math.abs(firstLeft + 1 - firstRight) + Math.abs(secondLeft - secondRight - 1);
  const reverse = Math.abs(secondLeft + 1 - secondRight) + Math.abs(firstLeft - firstRight - 1);
  return reverse < forward
    ? Object.freeze({ leftPhotoId: secondPhotoId, rightPhotoId: firstPhotoId })
    : Object.freeze({ leftPhotoId: firstPhotoId, rightPhotoId: secondPhotoId });
}

function validateParameters(parameters: BalancedEvidenceParameters): void {
  if (!Number.isInteger(parameters.evidenceMatchesPerPhoto) || parameters.evidenceMatchesPerPhoto < 1) {
    throw new RangeError('Balanced evidence matches per photo must be a positive integer.');
  }
  if (parameters.proximityWeight < 0 || parameters.unseenPairBonus < 0 || parameters.repeatedPairPenalty < 0) {
    throw new RangeError('Balanced evidence weights cannot be negative.');
  }
}

export class BalancedEvidencePairSelectionEngine implements PairSelectionEngine {
  private readonly parameters: BalancedEvidenceParameters;
  private readonly adaptiveSelector: AdaptivePairSelectionEngine;

  constructor(
    parameters: BalancedEvidenceParameters = DEFAULT_BALANCED_EVIDENCE_PARAMETERS,
    pairSelectionParameters: PairSelectionParameters = DEFAULT_RANKING_CONFIG.pairSelection,
  ) {
    validateParameters(parameters);
    this.parameters = Object.freeze({ ...parameters });
    this.adaptiveSelector = new AdaptivePairSelectionEngine(Object.freeze({
      ...pairSelectionParameters,
      initialCoverageMatches: 1,
    }));
  }

  selectNextPair(context: PairSelectionContext): SelectedPair | undefined {
    if (context.photoIds.length < 2) return undefined;
    const minimumMatches = Math.min(...context.photoIds.map((photoId) => ratingFor(context, photoId).matches));
    if (minimumMatches >= this.parameters.evidenceMatchesPerPhoto) {
      return this.adaptiveSelector.selectNextPair(context);
    }
    if (minimumMatches < 1) return this.adaptiveSelector.selectNextPair(context);

    const histories = pairHistory(context.history);
    const uncertaintyScale = Math.max(
      ...context.photoIds.map((photoId) => ratingFor(context, photoId).sigma),
      Number.EPSILON,
    );
    const sortedIds = [...context.photoIds].sort((left, right) => left.localeCompare(right));
    let candidates: Candidate[] = [];
    for (let firstIndex = 0; firstIndex < sortedIds.length; firstIndex += 1) {
      const firstPhotoId = sortedIds[firstIndex];
      if (!firstPhotoId) continue;
      for (let secondIndex = firstIndex + 1; secondIndex < sortedIds.length; secondIndex += 1) {
        const secondPhotoId = sortedIds[secondIndex];
        if (!secondPhotoId) continue;
        const first = ratingFor(context, firstPhotoId);
        const second = ratingFor(context, secondPhotoId);
        if (first.matches !== minimumMatches && second.matches !== minimumMatches) continue;
        const history = histories.get(pairKey(firstPhotoId, secondPhotoId));
        const pairCount = history?.count ?? 0;
        const bothAtMinimum = first.matches === minimumMatches && second.matches === minimumMatches;
        const proximity = 1 / (1 + Math.abs(first.mu - second.mu) / uncertaintyScale);
        candidates.push({
          firstPhotoId,
          secondPhotoId,
          pairCount,
          lastShownIndex: history?.lastShownIndex ?? Number.NEGATIVE_INFINITY,
          score: (bothAtMinimum ? 10 : 0)
            - first.matches - second.matches
            + this.parameters.proximityWeight * proximity
            + (pairCount === 0 ? this.parameters.unseenPairBonus : 0)
            - this.parameters.repeatedPairPenalty * pairCount,
        });
      }
    }
    const outsideCooldown = candidates.filter(({ lastShownIndex }) => (
      context.history.length - 1 - lastShownIndex >= DEFAULT_RANKING_CONFIG.pairSelection.repeatCooldownDecisions
    ));
    if (outsideCooldown.length > 0) candidates = outsideCooldown;
    candidates.sort((left, right) => (
      right.score - left.score
      || left.firstPhotoId.localeCompare(right.firstPhotoId)
      || left.secondPhotoId.localeCompare(right.secondPhotoId)
    ));
    const selected = candidates[0];
    if (!selected) return this.adaptiveSelector.selectNextPair(context);
    return Object.freeze({
      ...orient(context, selected.firstPhotoId, selected.secondPhotoId),
      stage: 'adaptive',
    });
  }
}
