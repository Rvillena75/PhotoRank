import { createSeededRandom, seedFromText } from '../confidence';
import type { PhotoId } from '../contracts';
import { DEFAULT_RANKING_CONFIG } from '../ranking-config';
import type { PairSelectionParameters } from '../ranking-config';
import { getTopK } from '../rating';
import type { ComparisonRecord, PhotoRating, RankingSession } from '../rating';
import { AdaptivePairSelectionEngine } from './adaptive-pair-selection-engine';
import type { PairSelectionContext, PairSelectionEngine, SelectedPair } from './types';

export interface TopTwoThompsonParameters {
  readonly posteriorSamples: number;
  readonly proximityWeight: number;
  readonly lowExposureWeight: number;
  readonly repeatedPairPenalty: number;
}

export const DEFAULT_TOP_TWO_THOMPSON_PARAMETERS: TopTwoThompsonParameters = Object.freeze({
  posteriorSamples: 256,
  proximityWeight: 0.2,
  lowExposureWeight: 0.1,
  repeatedPairPenalty: 0.05,
});

interface PairEvidence {
  count: number;
  lastShownIndex: number;
  lastSkipIndex: number;
}

interface Candidate {
  readonly insidePhotoId: PhotoId;
  readonly outsidePhotoId: PhotoId;
  readonly disagreement: number;
  readonly history: PairEvidence;
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

function sampleStandardNormal(first: number, second: number): number {
  return Math.sqrt(-2 * Math.log(Math.max(first, Number.MIN_VALUE))) * Math.cos(2 * Math.PI * second);
}

function contextSeed(context: PairSelectionContext): number {
  return seedFromText([
    context.k,
    ...[...context.photoIds].sort((left, right) => left.localeCompare(right)),
    ...context.history.map((record) => `${record.leftPhotoId}:${record.rightPhotoId}:${record.outcome.type}`),
  ].join('|'));
}

function buildHistory(history: readonly ComparisonRecord[]): ReadonlyMap<string, PairEvidence> {
  const result = new Map<string, PairEvidence>();
  history.forEach((record, index) => {
    const key = pairKey(record.leftPhotoId, record.rightPhotoId);
    const previous = result.get(key) ?? {
      count: 0,
      lastShownIndex: Number.NEGATIVE_INFINITY,
      lastSkipIndex: Number.NEGATIVE_INFINITY,
    };
    result.set(key, {
      count: previous.count + 1,
      lastShownIndex: index,
      lastSkipIndex: record.outcome.type === 'skip' ? index : previous.lastSkipIndex,
    });
  });
  return result;
}

function sideCounts(history: readonly ComparisonRecord[], photoId: PhotoId): Readonly<{ left: number; right: number }> {
  return history.reduce((counts, record) => ({
    left: counts.left + (record.leftPhotoId === photoId ? 1 : 0),
    right: counts.right + (record.rightPhotoId === photoId ? 1 : 0),
  }), { left: 0, right: 0 });
}

function orient(
  context: PairSelectionContext,
  firstPhotoId: PhotoId,
  secondPhotoId: PhotoId,
): Readonly<{ leftPhotoId: PhotoId; rightPhotoId: PhotoId }> {
  const first = sideCounts(context.history, firstPhotoId);
  const second = sideCounts(context.history, secondPhotoId);
  const forward = Math.abs(first.left + 1 - first.right) + Math.abs(second.left - second.right - 1);
  const reverse = Math.abs(second.left + 1 - second.right) + Math.abs(first.left - first.right - 1);
  return reverse < forward
    ? Object.freeze({ leftPhotoId: secondPhotoId, rightPhotoId: firstPhotoId })
    : Object.freeze({ leftPhotoId: firstPhotoId, rightPhotoId: secondPhotoId });
}

function validateParameters(parameters: TopTwoThompsonParameters): void {
  if (!Number.isInteger(parameters.posteriorSamples) || parameters.posteriorSamples < 16) {
    throw new RangeError('Top-Two Thompson posteriorSamples must be an integer of at least 16.');
  }
  if (parameters.proximityWeight < 0
    || parameters.lowExposureWeight < 0
    || parameters.repeatedPairPenalty < 0) {
    throw new RangeError('Top-Two Thompson weights cannot be negative.');
  }
}

export class TopTwoThompsonPairSelectionEngine implements PairSelectionEngine {
  private readonly parameters: TopTwoThompsonParameters;
  private readonly coverageSelector: AdaptivePairSelectionEngine;
  private readonly pairSelectionParameters: PairSelectionParameters;

  constructor(
    parameters: TopTwoThompsonParameters = DEFAULT_TOP_TWO_THOMPSON_PARAMETERS,
    pairSelectionParameters: PairSelectionParameters = DEFAULT_RANKING_CONFIG.pairSelection,
  ) {
    validateParameters(parameters);
    this.parameters = Object.freeze({ ...parameters });
    this.pairSelectionParameters = Object.freeze({ ...pairSelectionParameters, initialCoverageMatches: 1 });
    this.coverageSelector = new AdaptivePairSelectionEngine(this.pairSelectionParameters);
  }

  selectNextPair(context: PairSelectionContext): SelectedPair | undefined {
    if (context.photoIds.length < 2) return undefined;
    if (context.photoIds.some((photoId) => ratingFor(context, photoId).matches < 1)
      || context.k === context.photoIds.length) {
      return this.coverageSelector.selectNextPair(context);
    }

    const currentTopK = getTopK(context as RankingSession, context.k);
    const currentMembership = new Set(currentTopK);
    const disagreements = new Map<string, number>();
    const random = createSeededRandom(contextSeed(context));
    for (let sampleIndex = 0; sampleIndex < this.parameters.posteriorSamples; sampleIndex += 1) {
      const sampledTopK = context.photoIds.map((photoId) => {
        const rating = ratingFor(context, photoId);
        return {
          photoId,
          score: rating.mu + rating.sigma * sampleStandardNormal(random.next(), random.next()),
        };
      }).sort((left, right) => right.score - left.score || left.photoId.localeCompare(right.photoId))
        .slice(0, context.k)
        .map(({ photoId }) => photoId);
      const sampledMembership = new Set(sampledTopK);
      const removed = currentTopK.filter((photoId) => !sampledMembership.has(photoId));
      const added = sampledTopK.filter((photoId) => !currentMembership.has(photoId));
      if (removed.length === 0 || added.length === 0) continue;
      const contribution = 1 / (removed.length * added.length);
      for (const insidePhotoId of removed) {
        for (const outsidePhotoId of added) {
          const key = pairKey(insidePhotoId, outsidePhotoId);
          disagreements.set(key, (disagreements.get(key) ?? 0) + contribution);
        }
      }
    }

    const history = buildHistory(context.history);
    const uncertaintyScale = Math.max(
      ...context.photoIds.map((photoId) => ratingFor(context, photoId).sigma),
      Number.EPSILON,
    );
    let candidates: Candidate[] = [];
    for (const insidePhotoId of currentTopK) {
      for (const outsidePhotoId of context.photoIds.filter((photoId) => !currentMembership.has(photoId))) {
        const key = pairKey(insidePhotoId, outsidePhotoId);
        const disagreement = (disagreements.get(key) ?? 0) / this.parameters.posteriorSamples;
        if (disagreement === 0) continue;
        const pairEvidence = history.get(key) ?? {
          count: 0,
          lastShownIndex: Number.NEGATIVE_INFINITY,
          lastSkipIndex: Number.NEGATIVE_INFINITY,
        };
        const inside = ratingFor(context, insidePhotoId);
        const outside = ratingFor(context, outsidePhotoId);
        const proximity = 1 / (1 + Math.abs(inside.mu - outside.mu) / uncertaintyScale);
        const lowExposure = 1 / (1 + inside.matches + outside.matches);
        candidates.push({
          insidePhotoId,
          outsidePhotoId,
          disagreement,
          history: pairEvidence,
          score: disagreement
            + this.parameters.proximityWeight * proximity
            + this.parameters.lowExposureWeight * lowExposure
            - this.parameters.repeatedPairPenalty * pairEvidence.count,
        });
      }
    }
    const outsideSkipCooldown = candidates.filter(({ history: pairEvidence }) => (
      context.history.length - 1 - pairEvidence.lastSkipIndex >= this.pairSelectionParameters.skipCooldownDecisions
    ));
    if (outsideSkipCooldown.length > 0) candidates = outsideSkipCooldown;
    const outsideRepeatCooldown = candidates.filter(({ history: pairEvidence }) => (
      context.history.length - 1 - pairEvidence.lastShownIndex >= this.pairSelectionParameters.repeatCooldownDecisions
    ));
    if (outsideRepeatCooldown.length > 0) candidates = outsideRepeatCooldown;
    candidates.sort((left, right) => (
      right.score - left.score
      || right.disagreement - left.disagreement
      || left.insidePhotoId.localeCompare(right.insidePhotoId)
      || left.outsidePhotoId.localeCompare(right.outsidePhotoId)
    ));
    const selected = candidates[0];
    if (!selected) return this.coverageSelector.selectNextPair(context);
    return Object.freeze({
      ...orient(context, selected.insidePhotoId, selected.outsidePhotoId),
      stage: 'adaptive',
    });
  }
}
