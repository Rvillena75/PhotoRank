import { TsTrueSkillRatingEngine } from '../../../infrastructure/rating';
import type { PhotoRating } from '../types';

const engine = new TsTrueSkillRatingEngine();

function rating(mu: number, sigma: number): PhotoRating {
  return Object.freeze({ mu, sigma, matches: 0, wins: 0, losses: 0, draws: 0 });
}

function numericValues(value: PhotoRating): readonly number[] {
  return [value.mu, value.sigma, value.matches, value.wins, value.losses, value.draws];
}

describe('TsTrueSkillRatingEngine', () => {
  it('moves a winner relatively above the loser and updates statistics', () => {
    const initial = engine.createInitialRating();
    const result = engine.rate(initial, initial, { type: 'left' });

    expect(result.left.mu).toBeGreaterThan(initial.mu);
    expect(result.right.mu).toBeLessThan(initial.mu);
    expect(result.left.mu).toBeGreaterThan(result.right.mu);
    expect(result.left).toMatchObject({ matches: 1, wins: 1, losses: 0, draws: 0 });
    expect(result.right).toMatchObject({ matches: 1, wins: 0, losses: 1, draws: 0 });
  });

  it('supports a right-side winner without changing winner semantics', () => {
    const initial = engine.createInitialRating();
    const result = engine.rate(initial, initial, { type: 'right' });

    expect(result.right.mu).toBeGreaterThan(result.left.mu);
    expect(result.left.losses).toBe(1);
    expect(result.right.wins).toBe(1);
  });

  it('keeps a draw symmetric for identical priors', () => {
    const initial = engine.createInitialRating();
    const result = engine.rate(initial, initial, { type: 'draw' });

    expect(result.left.mu).toBeCloseTo(result.right.mu, 12);
    expect(result.left.sigma).toBeCloseTo(result.right.sigma, 12);
    expect(result.left).toMatchObject({ matches: 1, draws: 1, wins: 0, losses: 0 });
    expect(result.right).toMatchObject({ matches: 1, draws: 1, wins: 0, losses: 0 });
  });

  it('brings asymmetric priors closer after a draw', () => {
    const left = rating(35, 5);
    const right = rating(15, 5);
    const result = engine.rate(left, right, { type: 'draw' });

    expect(Math.abs(result.left.mu - result.right.mu)).toBeLessThan(Math.abs(left.mu - right.mu));
    expect(result.left.mu).toBeLessThan(left.mu);
    expect(result.right.mu).toBeGreaterThan(right.mu);
  });

  it('returns the exact ratings for skip and does not update statistics', () => {
    const left = engine.createInitialRating();
    const right = engine.createInitialRating();
    const result = engine.rate(left, right, { type: 'skip' });

    expect(result.left).toBe(left);
    expect(result.right).toBe(right);
    expect(result.left.matches).toBe(0);
    expect(result.right.matches).toBe(0);
  });

  it('keeps all values finite through a long mixed result sequence', () => {
    let left = engine.createInitialRating();
    let right = engine.createInitialRating();
    const outcomes = [{ type: 'left' }, { type: 'right' }, { type: 'draw' }] as const;

    for (let index = 0; index < 300; index += 1) {
      const outcome = outcomes[index % outcomes.length];
      if (!outcome) throw new Error('Missing deterministic outcome.');
      const result = engine.rate(left, right, outcome);
      left = result.left;
      right = result.right;
    }

    expect([...numericValues(left), ...numericValues(right)].every(Number.isFinite)).toBe(true);
    expect(left.sigma).toBeGreaterThan(0);
    expect(right.sigma).toBeGreaterThan(0);
  });
});
