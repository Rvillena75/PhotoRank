import type { ComparisonRecord } from '../../../domain/rating';
import { rankPhotoIds } from '../../../domain/rating';
import { BradleyTerryRatingEngine } from '../bradley-terry-rating-engine';

function record(
  id: string,
  leftPhotoId: string,
  rightPhotoId: string,
  outcome: 'left' | 'right' | 'draw',
): ComparisonRecord {
  return { id, leftPhotoId, rightPhotoId, outcome: { type: outcome }, createdAt: Number(id) };
}

describe('BradleyTerryRatingEngine', () => {
  it('infers a global transitive order independently of event arrival order', () => {
    const engine = new BradleyTerryRatingEngine();
    const photoIds = ['a', 'b', 'c'];
    const history = [
      record('1', 'a', 'b', 'left'),
      record('2', 'b', 'c', 'left'),
      record('3', 'a', 'c', 'left'),
    ];
    const forward = engine.inferRatings(photoIds, history);
    const reversed = engine.inferRatings(photoIds, [...history].reverse());

    expect(rankPhotoIds(forward)).toEqual(['a', 'b', 'c']);
    expect(rankPhotoIds(reversed)).toEqual(['a', 'b', 'c']);
    for (const photoId of photoIds) {
      expect(reversed[photoId]?.mu).toBeCloseTo(forward[photoId]?.mu ?? 0, 10);
      expect(reversed[photoId]?.sigma).toBeCloseTo(forward[photoId]?.sigma ?? 0, 10);
    }
  });

  it('keeps draw posteriors symmetric and ignores skips', () => {
    const engine = new BradleyTerryRatingEngine();
    const draw = record('1', 'a', 'b', 'draw');
    const ratings = engine.inferRatings(['a', 'b'], [draw, {
      id: '2',
      leftPhotoId: 'a',
      rightPhotoId: 'b',
      outcome: { type: 'skip' },
      createdAt: 2,
    }]);

    expect(ratings.a?.mu).toBeCloseTo(ratings.b?.mu ?? 0, 12);
    expect(ratings.a?.matches).toBe(1);
    expect(ratings.b?.matches).toBe(1);
  });
});
