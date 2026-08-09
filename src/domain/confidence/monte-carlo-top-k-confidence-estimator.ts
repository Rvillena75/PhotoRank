import { DEFAULT_RANKING_CONFIG } from '../ranking-config';
import { getTopK } from '../rating';
import type { RankingSession } from '../rating';
import type { RandomSource, TopKConfidenceEstimator, TopKConfidenceResult } from './types';

function sampleStandardNormal(random: RandomSource): number {
  // Avoid log(0), including for injected boundary-value RNGs.
  const first = Math.max(random.next(), Number.MIN_VALUE);
  const second = random.next();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function orderedKey(photoIds: readonly string[]): string {
  return photoIds.join('\u0001');
}

function membershipKey(photoIds: readonly string[]): string {
  return [...photoIds].sort((left, right) => left.localeCompare(right)).join('\u0001');
}

function validateSampleCount(sampleCount: number): void {
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new RangeError('Monte Carlo sample count must be a positive integer.');
  }
}

export class MonteCarloTopKConfidenceEstimator implements TopKConfidenceEstimator {
  private readonly sampleCount: number;

  constructor(sampleCount = DEFAULT_RANKING_CONFIG.confidence.samples) {
    validateSampleCount(sampleCount);
    this.sampleCount = sampleCount;
  }

  estimate(session: RankingSession, k: number, random: RandomSource): TopKConfidenceResult {
    const estimatedTopK = getTopK(session, k);
    const expectedMembership = membershipKey(estimatedTopK);
    const expectedOrder = orderedKey(estimatedTopK);
    const inclusionCounts = Object.fromEntries(session.photoIds.map((photoId) => [photoId, 0])) as Record<string, number>;
    let membershipMatches = 0;
    let orderMatches = 0;

    for (let sampleIndex = 0; sampleIndex < this.sampleCount; sampleIndex += 1) {
      const samples = session.photoIds.map((photoId) => {
        const rating = session.ratings[photoId];
        if (!rating) throw new Error(`Missing rating for photo: ${photoId}`);
        return { photoId, score: rating.mu + rating.sigma * sampleStandardNormal(random) };
      }).sort((left, right) => right.score - left.score || left.photoId.localeCompare(right.photoId));
      const sampledTopK = samples.slice(0, k).map(({ photoId }) => photoId);

      for (const photoId of sampledTopK) {
        inclusionCounts[photoId] = (inclusionCounts[photoId] ?? 0) + 1;
      }
      if (membershipKey(sampledTopK) === expectedMembership) membershipMatches += 1;
      if (orderedKey(sampledTopK) === expectedOrder) orderMatches += 1;
    }

    const inclusionProbabilities = Object.freeze(Object.fromEntries(
      session.photoIds.map((photoId) => [photoId, (inclusionCounts[photoId] ?? 0) / this.sampleCount]),
    ));
    const membershipStability = membershipMatches / this.sampleCount;
    const orderStability = orderMatches / this.sampleCount;
    return Object.freeze({
      inclusionProbabilities,
      membershipStability,
      orderStability,
      primaryStability: k === session.photoIds.length ? orderStability : membershipStability,
      sampleCount: this.sampleCount,
    });
  }
}
