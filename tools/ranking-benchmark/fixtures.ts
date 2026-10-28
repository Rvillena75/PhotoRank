import type { PhotoId } from '../../src/domain/contracts';
import type { RankingFixture, SyntheticGroup } from './types';

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function freezeRecord<T>(record: Record<string, T>): Readonly<Record<string, T>> {
  return Object.freeze(record);
}

function createIds(fixtureId: string, count: number): readonly PhotoId[] {
  return Object.freeze(Array.from({ length: count }, (_, index) => (
    `${fixtureId}-photo-${String(index + 1).padStart(2, '0')}`
  )));
}

function buildTiers(photoIds: readonly PhotoId[], tierSizes: readonly number[]): readonly (readonly PhotoId[])[] {
  let offset = 0;
  return Object.freeze(tierSizes.map((size) => {
    const tier = Object.freeze(photoIds.slice(offset, offset + size));
    offset += size;
    return tier;
  }));
}

function buildGroups(photoIds: readonly PhotoId[], groupSizes: readonly number[]): readonly SyntheticGroup[] {
  let offset = 0;
  return Object.freeze(groupSizes.map((size, index) => {
    const group = Object.freeze({
      id: `group-${String(index + 1).padStart(2, '0')}`,
      photoIds: Object.freeze(photoIds.slice(offset, offset + size)),
    });
    offset += size;
    return group;
  }));
}

function buildAcceptablePhotoIds(
  tiers: readonly (readonly PhotoId[])[],
  requestedSize: number,
): readonly PhotoId[] {
  let remaining = requestedSize;
  const acceptable: PhotoId[] = [];
  for (const tier of tiers) {
    if (remaining <= 0) break;
    acceptable.push(...tier);
    remaining -= tier.length;
  }
  return Object.freeze(acceptable);
}

function createFixture(
  id: string,
  k: number,
  tierSizes: readonly number[],
  groupSizes: readonly number[],
  rankPermutation: Readonly<{ step: number; offset: number }>,
): RankingFixture {
  const photoCount = sum(tierSizes);
  if (photoCount < 2 || sum(groupSizes) !== photoCount) {
    throw new Error(`Invalid synthetic fixture sizes for ${id}.`);
  }
  if (!Number.isInteger(k) || k < 1 || k > photoCount) {
    throw new Error(`Invalid K for synthetic fixture ${id}.`);
  }

  const photoIds = createIds(id, photoCount);
  const rankedPhotoIds = Object.freeze(Array.from({ length: photoCount }, (_, index) => (
    photoIds[(rankPermutation.offset + index * rankPermutation.step) % photoCount]
  )).filter((photoId): photoId is PhotoId => photoId !== undefined));
  if (new Set(rankedPhotoIds).size !== photoCount) {
    throw new Error(`Rank permutation must visit every photo exactly once for ${id}.`);
  }
  const tiers = buildTiers(rankedPhotoIds, tierSizes);
  const groups = buildGroups(photoIds, groupSizes);
  const tierByPhotoId: Record<PhotoId, number> = {};
  const targetRankByPhotoId: Record<PhotoId, number> = {};
  const groupByPhotoId: Record<PhotoId, string> = {};

  let targetRank = 0;
  tiers.forEach((tier, tierIndex) => {
    tier.forEach((photoId) => {
      tierByPhotoId[photoId] = tierIndex;
      targetRankByPhotoId[photoId] = targetRank;
      targetRank += 1;
    });
  });
  groups.forEach((group) => {
    group.photoIds.forEach((photoId) => {
      groupByPhotoId[photoId] = group.id;
    });
  });

  const targetCarouselGroupIds = groups
    .map((group) => ({
      groupId: group.id,
      bestTargetRank: Math.min(...group.photoIds.map((photoId) => targetRankByPhotoId[photoId] ?? Number.POSITIVE_INFINITY)),
    }))
    .sort((left, right) => left.bestTargetRank - right.bestTargetRank || left.groupId.localeCompare(right.groupId))
    .slice(0, Math.min(k, groups.length))
    .map(({ groupId }) => groupId);

  return Object.freeze({
    id,
    k,
    photoIds,
    tiers,
    tierByPhotoId: freezeRecord(tierByPhotoId),
    targetRankByPhotoId: freezeRecord(targetRankByPhotoId),
    targetTopK: Object.freeze(rankedPhotoIds.slice(0, k)),
    acceptableTopKPhotoIds: buildAcceptablePhotoIds(tiers, k),
    acceptableTop3PhotoIds: buildAcceptablePhotoIds(tiers, Math.min(3, k)),
    groups,
    groupByPhotoId: freezeRecord(groupByPhotoId),
    targetCarouselGroupIds: Object.freeze(targetCarouselGroupIds),
  });
}

export const TUNING_FIXTURES: readonly RankingFixture[] = Object.freeze([
  createFixture(
    'synthetic-20',
    5,
    [1, 1, 2, 1, 2, 3, 3, 3, 4],
    [2, 2, 2, 2, 3, 3, 3, 3],
    { step: 7, offset: 3 },
  ),
  createFixture(
    'synthetic-30',
    5,
    [1, 1, 2, 1, 2, 3, 4, 4, 5, 7],
    [2, 2, 2, 2, 3, 3, 4, 5, 4, 3],
    { step: 11, offset: 5 },
  ),
]);

export const HOLDOUT_FIXTURES: readonly RankingFixture[] = Object.freeze([
  createFixture(
    'synthetic-holdout-25',
    5,
    [1, 1, 2, 1, 2, 3, 3, 4, 4, 4],
    [2, 2, 2, 2, 3, 3, 3, 4, 4],
    { step: 7, offset: 11 },
  ),
]);

export const SYNTHETIC_FIXTURES: readonly RankingFixture[] = Object.freeze([
  ...TUNING_FIXTURES,
  ...HOLDOUT_FIXTURES,
]);
