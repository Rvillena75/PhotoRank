import { TsTrueSkillRatingEngine } from '../../../infrastructure/rating';
import {
  applyComparison,
  createRankingSession,
  getTopK,
  rebuildRankingSession,
  undoLastComparison,
} from '..';
import type { ComparisonOutcome, ComparisonRecord } from '..';

const engine = new TsTrueSkillRatingEngine();
const photoIds = ['photo-c', 'photo-a', 'photo-b'] as const;

function record(
  id: string,
  leftPhotoId: string,
  rightPhotoId: string,
  outcome: ComparisonOutcome,
  createdAt: number,
): ComparisonRecord {
  return { id, leftPhotoId, rightPhotoId, outcome, createdAt };
}

describe('immutable ranking session', () => {
  it('records skip without changing the ratings object', () => {
    const initial = createRankingSession(photoIds, engine);
    const skipped = applyComparison(initial, record('skip-1', 'photo-a', 'photo-b', { type: 'skip' }, 1), engine);

    expect(skipped).not.toBe(initial);
    expect(skipped.ratings).toBe(initial.ratings);
    expect(skipped.history).toHaveLength(1);
    expect(skipped.history[0]?.outcome.type).toBe('skip');
    expect(initial.history).toHaveLength(0);
  });

  it('undo reconstructs the exact state before the latest action', () => {
    const initial = createRankingSession(photoIds, engine);
    const afterFirst = applyComparison(initial, record('match-1', 'photo-a', 'photo-b', { type: 'left' }, 1), engine);
    const afterSecond = applyComparison(afterFirst, record('match-2', 'photo-c', 'photo-a', { type: 'draw' }, 2), engine);
    const undone = undoLastComparison(afterSecond, engine);

    expect(undone).toEqual(afterFirst);
    expect(undone).not.toBe(afterFirst);
    expect(afterSecond.history).toHaveLength(2);
  });

  it('rebuilds ratings and immutable history deterministically from events', () => {
    const history = [
      record('match-1', 'photo-a', 'photo-b', { type: 'left' }, 1),
      record('skip-1', 'photo-a', 'photo-c', { type: 'skip' }, 2),
      record('match-2', 'photo-c', 'photo-b', { type: 'right' }, 3),
      record('match-3', 'photo-a', 'photo-b', { type: 'draw' }, 4),
    ] as const;
    const rebuilt = rebuildRankingSession(photoIds, history, engine);
    const incrementallyBuilt = history.reduce(
      (session, comparison) => applyComparison(session, comparison, engine),
      createRankingSession(photoIds, engine),
    );

    expect(rebuilt).toEqual(incrementallyBuilt);
    expect(Object.isFrozen(rebuilt)).toBe(true);
    expect(Object.isFrozen(rebuilt.history)).toBe(true);
    expect(Object.isFrozen(rebuilt.history[0])).toBe(true);
    expect(Object.isFrozen(rebuilt.ratings)).toBe(true);
    expect(Object.values(rebuilt.ratings).every(Object.isFrozen)).toBe(true);
  });

  it('undoes a skip while preserving the preceding posterior', () => {
    const initial = createRankingSession(photoIds, engine);
    const decided = applyComparison(initial, record('match-1', 'photo-a', 'photo-b', { type: 'right' }, 1), engine);
    const skipped = applyComparison(decided, record('skip-1', 'photo-a', 'photo-c', { type: 'skip' }, 2), engine);

    expect(undoLastComparison(skipped, engine)).toEqual(decided);
  });

  it('returns one photo for K=1 with deterministic id tie-breaking', () => {
    const session = createRankingSession(photoIds, engine);
    expect(getTopK(session, 1)).toEqual(['photo-a']);
  });

  it('returns exactly all photos for K=N', () => {
    const session = createRankingSession(photoIds, engine);
    expect(getTopK(session, photoIds.length)).toEqual(['photo-a', 'photo-b', 'photo-c']);
  });

  it('rejects invalid K values and malformed events', () => {
    const session = createRankingSession(photoIds, engine);
    expect(() => getTopK(session, 0)).toThrow(RangeError);
    expect(() => getTopK(session, photoIds.length + 1)).toThrow(RangeError);
    expect(() => applyComparison(
      session,
      record('self', 'photo-a', 'photo-a', { type: 'left' }, 1),
      engine,
    )).toThrow('cannot be compared with itself');
  });
});
