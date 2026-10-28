export interface RatingParameters {
  readonly initialMu: number;
  readonly initialSigma: number;
  readonly beta: number;
  readonly tau: number;
  readonly drawProbability: number;
  readonly conservativeSigmaMultiplier: number;
}

export interface PairSelectionParameters {
  readonly initialCoverageMatches: number;
  readonly skipCooldownDecisions: number;
  readonly repeatCooldownDecisions: number;
  readonly coverageDeficitWeight: number;
  readonly doubleCoverageBonus: number;
  readonly unseenPairBonus: number;
  readonly uncertaintyWeight: number;
  readonly ratingProximityWeight: number;
  readonly frontierWeight: number;
  readonly frontierCrossingBonus: number;
  readonly lowExposureWeight: number;
  readonly repeatedPairPenalty: number;
  readonly recentPairPenalty: number;
  readonly sideImbalancePenalty: number;
  readonly skippedPairPenalty: number;
}

export interface RankingConfig {
  readonly rating: RatingParameters;
  readonly pairSelection: PairSelectionParameters;
  readonly confidence: TopKConfidenceParameters;
}

export interface TopKConfidenceParameters {
  readonly samples: number;
  readonly initialCoverageMatches: number;
  readonly minimumDecisions: number;
  readonly earlyReviewDecisions: number;
  readonly checkpointMultiplier: number;
  readonly extensionBlockMultiplier: number;
  readonly hardMaximumMultiplier: number;
  readonly expectedOverlapEnterThreshold: number;
  readonly expectedOverlapExitThreshold: number;
  /** Legacy fixed cap retained only for frozen benchmark variants. */
  readonly maximumDecisions: number;
  readonly membershipEnterThreshold: number;
  readonly membershipExitThreshold: number;
  readonly orderEnterThreshold: number;
  readonly orderExitThreshold: number;
  readonly stableDecisionCount: number;
}

export const DEFAULT_RANKING_CONFIG: RankingConfig = Object.freeze({
  rating: Object.freeze({
    initialMu: 25,
    initialSigma: 25 / 3,
    beta: 25 / 6,
    tau: 25 / 300,
    drawProbability: 0.1,
    conservativeSigmaMultiplier: 3,
  }),
  pairSelection: Object.freeze({
    initialCoverageMatches: 1,
    skipCooldownDecisions: 3,
    repeatCooldownDecisions: 2,
    coverageDeficitWeight: 10,
    doubleCoverageBonus: 4,
    unseenPairBonus: 3,
    uncertaintyWeight: 2,
    ratingProximityWeight: 3,
    frontierWeight: 6,
    frontierCrossingBonus: 4,
    lowExposureWeight: 1,
    repeatedPairPenalty: 2,
    recentPairPenalty: 8,
    sideImbalancePenalty: 0.25,
    skippedPairPenalty: 100,
  }),
  confidence: Object.freeze({
    samples: 1000,
    initialCoverageMatches: 1,
    minimumDecisions: 8,
    earlyReviewDecisions: 20,
    checkpointMultiplier: 2,
    extensionBlockMultiplier: 0.5,
    hardMaximumMultiplier: 4,
    expectedOverlapEnterThreshold: 0.9,
    expectedOverlapExitThreshold: 0.84,
    maximumDecisions: 100,
    membershipEnterThreshold: 0.86,
    membershipExitThreshold: 0.8,
    orderEnterThreshold: 0.7,
    orderExitThreshold: 0.62,
    stableDecisionCount: 3,
  }),
});
