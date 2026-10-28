import { TsTrueSkillRatingEngine } from '../../../infrastructure/rating';
import {
  applyComparison,
  createManualTopKResolution,
  createRankingSession,
} from '..';

describe('manual Top K resolution', () => {
  const engine = new TsTrueSkillRatingEngine();

  it('records a separate user selection ordered by the estimated ranking', () => {
    let session = createRankingSession(['a', 'b', 'c'], engine);
    session = applyComparison(session, {
      id: '1',
      leftPhotoId: 'b',
      rightPhotoId: 'a',
      outcome: { type: 'left' },
      createdAt: 1,
    }, engine);

    const resolution = createManualTopKResolution(session, 2, ['c', 'b'], 10);

    expect(resolution.selectedPhotoIds).toEqual(['b', 'c']);
    expect(resolution.automaticTopKPhotoIds).toEqual(['b', 'c']);
    expect(resolution.source).toBe('hard-limit');
    expect(session.history).toHaveLength(1);
  });

  it('requires exactly K unique photos from the session', () => {
    const session = createRankingSession(['a', 'b', 'c'], engine);
    expect(() => createManualTopKResolution(session, 2, ['a'], 1)).toThrow(/exactly 2/u);
    expect(() => createManualTopKResolution(session, 2, ['a', 'a'], 1)).toThrow(/unique/u);
    expect(() => createManualTopKResolution(session, 2, ['a', 'outside'], 1)).toThrow(/ranking session/u);
  });

  it('distinguishes voluntary confirmation and leaves ratings and history untouched for K=1 and K=N', () => {
    const session = createRankingSession(['a', 'b', 'c'], engine);
    const ratings = session.ratings;
    const history = session.history;
    const single = createManualTopKResolution(session, 1, ['c'], 1, 'user-confirmation');
    const all = createManualTopKResolution(session, 3, ['c', 'b', 'a'], 2, 'user-confirmation');
    expect(single.source).toBe('user-confirmation');
    expect(single.selectedPhotoIds).toEqual(['c']);
    expect(single.automaticTopKPhotoIds).toEqual(['a']);
    expect(all.selectedPhotoIds).toEqual(['a', 'b', 'c']);
    expect(session.ratings).toBe(ratings);
    expect(session.history).toBe(history);
  });
});
