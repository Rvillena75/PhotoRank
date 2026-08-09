import type { PhotoId } from '../contracts';

export interface PhotoRating {
  readonly mu: number;
  readonly sigma: number;
  readonly matches: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

export type ComparisonOutcome =
  | Readonly<{ type: 'left' }>
  | Readonly<{ type: 'right' }>
  | Readonly<{ type: 'draw' }>
  | Readonly<{ type: 'skip' }>;

export type RatedComparisonOutcome = Exclude<ComparisonOutcome, Readonly<{ type: 'skip' }>>;

export interface ComparisonRecord {
  readonly id: string;
  readonly leftPhotoId: PhotoId;
  readonly rightPhotoId: PhotoId;
  readonly outcome: ComparisonOutcome;
  readonly createdAt: number;
}

export interface RankingSession {
  readonly photoIds: readonly PhotoId[];
  readonly ratings: Readonly<Record<PhotoId, PhotoRating>>;
  readonly history: readonly ComparisonRecord[];
}

export interface RatedPair {
  readonly left: PhotoRating;
  readonly right: PhotoRating;
}
