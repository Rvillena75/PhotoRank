import type { PhotoId } from '../contracts';
import type { PhotoRating, RankingSession } from './types';

function compareRatings(
  left: readonly [PhotoId, PhotoRating],
  right: readonly [PhotoId, PhotoRating],
): number {
  const muDifference = right[1].mu - left[1].mu;
  return muDifference === 0 ? left[0].localeCompare(right[0]) : muDifference;
}

export function rankPhotoIds(ratings: Readonly<Record<PhotoId, PhotoRating>>): readonly PhotoId[] {
  return Object.entries(ratings).sort(compareRatings).map(([photoId]) => photoId);
}

export function getTopK(session: RankingSession, k: number): readonly PhotoId[] {
  if (!Number.isInteger(k) || k < 1 || k > session.photoIds.length) {
    throw new RangeError(`K must be an integer between 1 and ${session.photoIds.length}.`);
  }
  return Object.freeze(rankPhotoIds(session.ratings).slice(0, k));
}
