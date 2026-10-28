import { TsTrueSkillRatingEngine } from '../../../infrastructure/rating';
import { applyComparison, createRankingSession } from '../../rating';
import type { ComparisonOutcome, ComparisonRecord, PhotoRating, RankingSession } from '../../rating';
import { AdaptivePairSelectionEngine } from '..';
import type { PairSelectionContext, SelectedPair } from '..';

const ratingEngine = new TsTrueSkillRatingEngine();
const selector = new AdaptivePairSelectionEngine();

function comparison(
  id: string,
  pair: SelectedPair,
  outcome: ComparisonOutcome = { type: 'left' },
): ComparisonRecord {
  return {
    id,
    leftPhotoId: pair.leftPhotoId,
    rightPhotoId: pair.rightPhotoId,
    outcome,
    createdAt: Number(id.replace(/\D/g, '')) || 0,
  };
}

function coveredRating(mu: number, sigma = 5): PhotoRating {
  return { mu, sigma, matches: 2, wins: 1, losses: 1, draws: 0 };
}

function adaptiveContext(
  ratings: Readonly<Record<string, PhotoRating>>,
  k: number,
  history: readonly ComparisonRecord[] = [],
): PairSelectionContext {
  return { photoIds: Object.keys(ratings), ratings, history, k };
}

function selectedOrThrow(context: PairSelectionContext): SelectedPair {
  const selected = selector.selectNextPair(context);
  if (!selected) throw new Error('Expected a selected pair.');
  return selected;
}

function sameUnorderedPair(pair: SelectedPair, firstPhotoId: string, secondPhotoId: string): boolean {
  return new Set([pair.leftPhotoId, pair.rightPhotoId]).size === 2
    && pair.leftPhotoId !== pair.rightPhotoId
    && [pair.leftPhotoId, pair.rightPhotoId].includes(firstPhotoId)
    && [pair.leftPhotoId, pair.rightPhotoId].includes(secondPhotoId);
}

describe('AdaptivePairSelectionEngine', () => {
  it('gives every photo the configured initial coverage', () => {
    let session: RankingSession = createRankingSession(['a', 'b', 'c', 'd', 'e'], ratingEngine);
    let decisions = 0;

    while (Object.values(session.ratings).some(({ matches }) => matches < 1) && decisions < 20) {
      const pair = selectedOrThrow({ ...session, k: 2 });
      expect(pair.stage).toBe('coverage');
      session = applyComparison(session, comparison(`match-${decisions + 1}`, pair), ratingEngine);
      decisions += 1;
    }

    expect(Object.values(session.ratings).every(({ matches }) => matches >= 1)).toBe(true);
    expect(decisions).toBeLessThanOrEqual(3);
    expect(selector.selectNextPair({ ...session, k: 2 })?.stage).toBe('adaptive');
  });

  it('avoids an immediate repeated pair when another pair is available', () => {
    const session = createRankingSession(['a', 'b', 'c'], ratingEngine);
    const first = selectedOrThrow({ ...session, k: 1 });
    const afterFirst = applyComparison(session, comparison('match-1', first), ratingEngine);
    const second = selectedOrThrow({ ...afterFirst, k: 1 });

    expect(sameUnorderedPair(second, first.leftPhotoId, first.rightPhotoId)).toBe(false);
  });

  it('prioritizes the two photos around the Top K frontier after coverage', () => {
    const context = adaptiveContext({
      a: coveredRating(40),
      b: coveredRating(32),
      c: coveredRating(25.1, 6),
      d: coveredRating(25, 6),
      e: coveredRating(10),
    }, 3);

    const pair = selectedOrThrow(context);
    expect(pair.stage).toBe('adaptive');
    expect(sameUnorderedPair(pair, 'c', 'd')).toBe(true);
  });

  it('prefers uncertainty when there is no Top K membership frontier', () => {
    const pair = selectedOrThrow(adaptiveContext({
      a: coveredRating(25.1, 8),
      b: coveredRating(25, 8),
      c: coveredRating(25.1, 2),
      d: coveredRating(25, 2),
    }, 4));

    expect(sameUnorderedPair(pair, 'a', 'b')).toBe(true);
  });

  it('applies cooldown to a recently skipped pair', () => {
    const ratings = {
      a: coveredRating(40),
      b: coveredRating(32),
      c: coveredRating(25.1, 6),
      d: coveredRating(25, 6),
      e: coveredRating(10),
    };
    const skippedPair: SelectedPair = { leftPhotoId: 'c', rightPhotoId: 'd', stage: 'adaptive' };
    const history = [comparison('skip-1', skippedPair, { type: 'skip' })];

    const pair = selectedOrThrow(adaptiveContext(ratings, 3, history));
    expect(sameUnorderedPair(pair, 'c', 'd')).toBe(false);
  });

  it('balances left and right for an unavoidable repeated two-photo pair', () => {
    const ratings = { a: coveredRating(25), b: coveredRating(25) };
    let history: readonly ComparisonRecord[] = [];

    for (let index = 0; index < 10; index += 1) {
      const pair = selectedOrThrow(adaptiveContext(ratings, 1, history));
      history = [...history, comparison(`match-${index + 1}`, pair)];
    }

    for (const photoId of ['a', 'b']) {
      const leftCount = history.filter(({ leftPhotoId }) => leftPhotoId === photoId).length;
      const rightCount = history.filter(({ rightPhotoId }) => rightPhotoId === photoId).length;
      expect(Math.abs(leftCount - rightCount)).toBeLessThanOrEqual(1);
    }
  });

  it('supports K=1 and targets its membership frontier', () => {
    const pair = selectedOrThrow(adaptiveContext({
      a: coveredRating(30),
      b: coveredRating(29.9),
      c: coveredRating(10),
    }, 1));
    expect(sameUnorderedPair(pair, 'a', 'b')).toBe(true);
  });

  it('supports K=N without a membership frontier', () => {
    const context = adaptiveContext({
      a: coveredRating(30),
      b: coveredRating(29),
      c: coveredRating(28),
    }, 3);
    const first = selectedOrThrow(context);
    const second = selectedOrThrow(context);

    expect(first.stage).toBe('adaptive');
    expect(second).toEqual(first);
  });

  it('handles one and two-photo sessions deterministically', () => {
    expect(selector.selectNextPair(adaptiveContext({ a: coveredRating(25) }, 1))).toBeUndefined();
    expect(selectedOrThrow(adaptiveContext({ b: coveredRating(25), a: coveredRating(25) }, 1))).toEqual({
      leftPhotoId: 'a',
      rightPhotoId: 'b',
      stage: 'adaptive',
    });
  });
});
