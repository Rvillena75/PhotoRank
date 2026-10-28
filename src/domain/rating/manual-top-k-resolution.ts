import type { PhotoId } from '../contracts';
import { getTopK, rankPhotoIds } from './top-k';
import type { RankingSession } from './types';

export interface ManualTopKResolution {
  readonly source: 'hard-limit' | 'user-confirmation';
  readonly selectedPhotoIds: readonly PhotoId[];
  readonly automaticTopKPhotoIds: readonly PhotoId[];
  readonly createdAt: number;
}

export function createManualTopKResolution(
  session: RankingSession,
  k: number,
  selectedPhotoIds: readonly PhotoId[],
  createdAt: number,
  source: ManualTopKResolution['source'] = 'hard-limit',
): ManualTopKResolution {
  if (!Number.isInteger(k) || k < 1 || k > session.photoIds.length) {
    throw new RangeError(`K must be an integer between 1 and ${session.photoIds.length}.`);
  }
  if (selectedPhotoIds.length !== k || new Set(selectedPhotoIds).size !== k) {
    throw new Error(`Manual resolution must contain exactly ${k} unique photos.`);
  }
  const sessionPhotoIds = new Set(session.photoIds);
  if (selectedPhotoIds.some((photoId) => !sessionPhotoIds.has(photoId))) {
    throw new Error('Manual resolution can only contain photos from the ranking session.');
  }
  if (!Number.isFinite(createdAt)) throw new Error('Manual resolution createdAt must be finite.');
  const selected = new Set(selectedPhotoIds);
  const orderedSelection = rankPhotoIds(session.ratings).filter((photoId) => selected.has(photoId));
  return Object.freeze({
    source,
    selectedPhotoIds: Object.freeze(orderedSelection),
    automaticTopKPhotoIds: Object.freeze(getTopK(session, k)),
    createdAt,
  });
}
