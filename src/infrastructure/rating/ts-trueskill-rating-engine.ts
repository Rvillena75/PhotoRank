import { Rating, TrueSkill, rate_1vs1 } from 'ts-trueskill';

import type { ComparisonOutcome, PhotoRating, RatedPair, RatingEngine } from '../../domain/rating';
import { DEFAULT_RANKING_CONFIG } from '../../domain/ranking-config';
import type { RatingParameters } from '../../domain/ranking-config';

function ensureCryptoRandomValues(): void {
  if (typeof globalThis.crypto?.getRandomValues === 'function') return;
  // Node and Web expose crypto natively. Native React Native needs the small
  // shim, loaded only on that path so the pure benchmark can run in Node.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-get-random-values');
}

ensureCryptoRandomValues();

function assertFiniteRating(rating: PhotoRating): void {
  const numericValues = [
    rating.mu,
    rating.sigma,
    rating.matches,
    rating.wins,
    rating.losses,
    rating.draws,
  ];
  if (!numericValues.every(Number.isFinite) || rating.sigma <= 0) {
    throw new Error('Rating engine produced an invalid rating.');
  }
}

function withStatistics(
  source: PhotoRating,
  posterior: Rating,
  result: 'win' | 'loss' | 'draw',
): PhotoRating {
  const rating = Object.freeze({
    mu: posterior.mu,
    sigma: posterior.sigma,
    matches: source.matches + 1,
    wins: source.wins + (result === 'win' ? 1 : 0),
    losses: source.losses + (result === 'loss' ? 1 : 0),
    draws: source.draws + (result === 'draw' ? 1 : 0),
  });
  assertFiniteRating(rating);
  return rating;
}

export class TsTrueSkillRatingEngine implements RatingEngine {
  readonly parameters: RatingParameters;
  private readonly environment: TrueSkill;

  constructor(parameters: RatingParameters = DEFAULT_RANKING_CONFIG.rating) {
    this.parameters = Object.freeze({ ...parameters });
    this.environment = new TrueSkill(
      parameters.initialMu,
      parameters.initialSigma,
      parameters.beta,
      parameters.tau,
      parameters.drawProbability,
    );
  }

  createInitialRating(): PhotoRating {
    const rating = Object.freeze({
      mu: this.parameters.initialMu,
      sigma: this.parameters.initialSigma,
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    });
    assertFiniteRating(rating);
    return rating;
  }

  rate(left: PhotoRating, right: PhotoRating, outcome: ComparisonOutcome): RatedPair {
    assertFiniteRating(left);
    assertFiniteRating(right);
    if (outcome.type === 'skip') return Object.freeze({ left, right });

    const leftPrior = new Rating(left.mu, left.sigma);
    const rightPrior = new Rating(right.mu, right.sigma);

    if (outcome.type === 'right') {
      const [rightPosterior, leftPosterior] = rate_1vs1(rightPrior, leftPrior, false, undefined, this.environment);
      return Object.freeze({
        left: withStatistics(left, leftPosterior, 'loss'),
        right: withStatistics(right, rightPosterior, 'win'),
      });
    }

    const [leftPosterior, rightPosterior] = rate_1vs1(
      leftPrior,
      rightPrior,
      outcome.type === 'draw',
      undefined,
      this.environment,
    );
    const result = outcome.type === 'draw' ? 'draw' : 'win';
    return Object.freeze({
      left: withStatistics(left, leftPosterior, result),
      right: withStatistics(right, rightPosterior, outcome.type === 'draw' ? 'draw' : 'loss'),
    });
  }

  conservativeScore(rating: PhotoRating): number {
    assertFiniteRating(rating);
    return rating.mu - this.parameters.conservativeSigmaMultiplier * rating.sigma;
  }
}
