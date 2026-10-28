import { getTopK, rankPhotoIds } from '../../src/domain/rating';
import type { RankingSession } from '../../src/domain/rating';
import type { CarouselEvaluation, CarouselPolicyId, RankingFixture } from './types';

function unique<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)]);
}

function intersectionSize(left: readonly string[], right: readonly string[]): number {
  const rightSet = new Set(right);
  return left.reduce((count, value) => count + (rightSet.has(value) ? 1 : 0), 0);
}

function selectTopKAsCarousel(session: RankingSession, fixture: RankingFixture): readonly string[] {
  return getTopK(session, fixture.k);
}

/**
 * Contract-level reference only. It measures whether a future production MMR
 * implementation can preserve one representative per confirmed group. It is
 * deliberately not used by the app and does not claim to implement MMR.
 */
function selectGroupDiverseReference(session: RankingSession, fixture: RankingFixture): readonly string[] {
  const rankedPhotoIds = rankPhotoIds(session.ratings);
  const selected: string[] = [];
  const selectedGroups = new Set<string>();
  const targetSize = Math.min(fixture.k, fixture.groups.length);

  for (const photoId of rankedPhotoIds) {
    const groupId = fixture.groupByPhotoId[photoId];
    if (!groupId || selectedGroups.has(groupId)) continue;
    selected.push(photoId);
    selectedGroups.add(groupId);
    if (selected.length === targetSize) break;
  }

  return Object.freeze(selected);
}

export function evaluateCarouselPolicy(
  policy: CarouselPolicyId,
  session: RankingSession,
  fixture: RankingFixture,
): CarouselEvaluation {
  const orderedPhotoIds = policy === 'top-k'
    ? selectTopKAsCarousel(session, fixture)
    : selectGroupDiverseReference(session, fixture);
  const selectedGroupIds = unique(orderedPhotoIds.map((photoId) => fixture.groupByPhotoId[photoId]).filter(
    (groupId): groupId is string => groupId !== undefined,
  ));
  const targetGroupIds = fixture.targetCarouselGroupIds;
  const targetGroupIntersection = intersectionSize(selectedGroupIds, targetGroupIds);
  const targetSize = Math.min(fixture.k, fixture.groups.length);

  return Object.freeze({
    policy,
    orderedPhotoIds,
    selectedGroupIds,
    targetGroupIds,
    targetSize,
    uniqueGroupCount: selectedGroupIds.length,
    duplicateGroupSlots: orderedPhotoIds.length - selectedGroupIds.length,
    targetGroupRecall: targetGroupIds.length === 0 ? 1 : targetGroupIntersection / targetGroupIds.length,
    targetGroupPrecision: selectedGroupIds.length === 0 ? 0 : targetGroupIntersection / selectedGroupIds.length,
    targetGroupSetExact: selectedGroupIds.length === targetGroupIds.length
      && targetGroupIntersection === targetGroupIds.length,
    hasAtMostOnePhotoPerGroup: orderedPhotoIds.length === selectedGroupIds.length,
    hasExpectedSize: orderedPhotoIds.length === targetSize,
  });
}

export function evaluateCarouselPolicies(
  session: RankingSession,
  fixture: RankingFixture,
): Readonly<Record<CarouselPolicyId, CarouselEvaluation>> {
  return Object.freeze({
    'top-k': evaluateCarouselPolicy('top-k', session, fixture),
    'group-diverse-reference': evaluateCarouselPolicy('group-diverse-reference', session, fixture),
  });
}
