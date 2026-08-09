import type { RatingParameters } from '../ranking-config';
import type { ComparisonOutcome, PhotoRating, RatedPair } from './types';

export interface RatingEngine {
  readonly parameters: RatingParameters;
  createInitialRating(): PhotoRating;
  rate(left: PhotoRating, right: PhotoRating, outcome: ComparisonOutcome): RatedPair;
  conservativeScore(rating: PhotoRating): number;
}
