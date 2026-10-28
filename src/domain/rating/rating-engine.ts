import type { RatingParameters } from '../ranking-config';
import type { PhotoId } from '../contracts';
import type {
  ComparisonOutcome,
  ComparisonRecord,
  PhotoRating,
  RatedPair,
} from './types';

export interface RatingEngine {
  readonly parameters: RatingParameters;
  createInitialRating(): PhotoRating;
  rate(left: PhotoRating, right: PhotoRating, outcome: ComparisonOutcome): RatedPair;
  conservativeScore(rating: PhotoRating): number;
  inferRatings?(
    photoIds: readonly PhotoId[],
    history: readonly ComparisonRecord[],
  ): Readonly<Record<PhotoId, PhotoRating>>;
}
