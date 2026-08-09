export type PhotoId = string;
export type GroupId = string;

export interface PhotoAsset {
  readonly id: PhotoId;
  readonly uri: string;
  readonly width?: number;
  readonly height?: number;
  readonly filename?: string;
  readonly assetId?: string;
}

export type { RatingEngine } from './rating';
export type { PairSelectionEngine } from './pair-selection';
export type { TopKConfidenceEstimator } from './confidence';

export interface ImageEmbeddingEngine {
  initialize(): Promise<void>;
  embed(photo: PhotoAsset): Promise<readonly number[]>;
  dispose(): Promise<void>;
}

export interface PhotoSimilarityEngine {
  compare(left: readonly number[], right: readonly number[]): number;
}

export interface PhotoGroupingEngine {
  group(photoIds: readonly PhotoId[]): readonly (readonly PhotoId[])[];
}

export interface CarouselRecommendationEngine {
  recommend(groupIds: readonly GroupId[], targetSize: number): readonly PhotoId[];
}
