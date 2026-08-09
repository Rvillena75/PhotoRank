import type { PhotoId } from '../contracts';
import type { RankingSession } from '../rating';

/** A source of uniform random numbers in [0, 1). */
export interface RandomSource {
  next(): number;
}

export interface TopKConfidenceResult {
  readonly inclusionProbabilities: Readonly<Record<PhotoId, number>>;
  /** Frequency with which the estimated current Top K membership recurs. */
  readonly membershipStability: number;
  /** Frequency with which the complete ordered current Top K recurs. */
  readonly orderStability: number;
  /** Membership except when K=N, where only the ordering remains informative. */
  readonly primaryStability: number;
  readonly sampleCount: number;
}

export interface TopKConfidenceEstimator {
  estimate(session: RankingSession, k: number, random: RandomSource): TopKConfidenceResult;
}

export type StabilityLevel = 'initial' | 'fairly-stable' | 'very-stable';

export interface StopRecommendation {
  readonly coverage: number;
  readonly stabilityLevel: StabilityLevel;
  readonly isStable: boolean;
  readonly isMaximumReached: boolean;
  readonly stableDecisionCount: number;
  readonly reason: 'collecting-coverage' | 'collecting-evidence' | 'stable' | 'maximum-reached';
}

export interface StopRecommendationState {
  readonly wasStable: boolean;
  readonly consecutiveStableDecisions: number;
}
