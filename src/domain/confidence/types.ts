import type { PhotoId } from '../contracts';
import type { RankingSession } from '../rating';

/** A source of uniform random numbers in [0, 1). */
export interface RandomSource {
  next(): number;
}

export interface TopKConfidenceResult {
  readonly inclusionProbabilities: Readonly<Record<PhotoId, number>>;
  /** Expected fraction of the current Top K that reappears in a posterior sample. */
  readonly expectedTopKOverlap: number;
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
  readonly isCheckpointReached: boolean;
  readonly isReviewPoint: boolean;
  readonly isHardLimitReached: boolean;
  readonly canContinueComparing: boolean;
  readonly requiresManualResolution: boolean;
  /** Voluntary confirmation after the early review threshold and full coverage. */
  readonly canReviewSelection: boolean;
  readonly checkpointDecisions: number;
  readonly nextReviewDecision: number;
  readonly hardLimitDecisions: number;
  /** Compatibility alias for the former fixed maximum. */
  readonly isMaximumReached: boolean;
  readonly stableDecisionCount: number;
  readonly reason:
    | 'collecting-coverage'
    | 'collecting-evidence'
    | 'checkpoint-reached'
    | 'extending-evidence'
    | 'stable'
    | 'resolution-required';
}

export interface StopRecommendationState {
  readonly wasStable: boolean;
  readonly consecutiveStableDecisions: number;
  readonly lastMembershipKey?: string;
}
