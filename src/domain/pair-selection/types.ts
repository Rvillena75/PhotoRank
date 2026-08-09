import type { PhotoId } from '../contracts';
import type { ComparisonRecord, PhotoRating } from '../rating';

export interface PairSelectionContext {
  readonly photoIds: readonly PhotoId[];
  readonly ratings: Readonly<Record<PhotoId, PhotoRating>>;
  readonly history: readonly ComparisonRecord[];
  readonly k: number;
}

export interface SelectedPair {
  readonly leftPhotoId: PhotoId;
  readonly rightPhotoId: PhotoId;
  readonly stage: 'coverage' | 'adaptive';
}

export interface PairSelectionEngine {
  selectNextPair(context: PairSelectionContext): SelectedPair | undefined;
}
