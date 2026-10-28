import type { PhotoId } from '../../src/domain/contracts';
import type {
  BalancedEvidenceParameters,
  TopTwoThompsonParameters,
  TopKInformationGainParameters,
} from '../../src/domain/pair-selection';
import type { PairSelectionParameters } from '../../src/domain/ranking-config';

export type HumanProfileId = 'deterministic' | 'consistent' | 'habitual' | 'ambiguous';

export type BenchmarkStopPolicy = 'legacy-membership' | 'expected-overlap' | 'production';

export type CarouselPolicyId = 'top-k' | 'group-diverse-reference';

export interface SyntheticGroup {
  readonly id: string;
  readonly photoIds: readonly PhotoId[];
}

export interface RankingFixture {
  readonly id: string;
  readonly k: number;
  readonly photoIds: readonly PhotoId[];
  readonly tiers: readonly (readonly PhotoId[])[];
  readonly tierByPhotoId: Readonly<Record<PhotoId, number>>;
  readonly targetRankByPhotoId: Readonly<Record<PhotoId, number>>;
  readonly targetTopK: readonly PhotoId[];
  readonly acceptableTopKPhotoIds: readonly PhotoId[];
  readonly acceptableTop3PhotoIds: readonly PhotoId[];
  readonly groups: readonly SyntheticGroup[];
  readonly groupByPhotoId: Readonly<Record<PhotoId, string>>;
  readonly targetCarouselGroupIds: readonly string[];
}

export interface HumanProfile {
  readonly id: HumanProfileId;
  readonly label: string;
  readonly description: string;
  readonly noiseScale: number;
  readonly baseDrawProbability: number;
  readonly closeDrawBoost: number;
  readonly baseSkipProbability: number;
  readonly closeSkipBoost: number;
  readonly contradictionProbability: number;
  readonly repeatFlipProbability: number;
  readonly leftSideBias: number;
  readonly decisionTimeMs: Readonly<{
    readonly base: number;
    readonly jitter: number;
  }>;
  readonly deterministicTies: boolean;
}

export interface BenchmarkVariant {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly selector: 'adaptive' | 'top-k-information-gain' | 'balanced-evidence' | 'top-two-thompson';
  readonly ratingModel: 'true-skill' | 'bradley-terry';
  readonly pairSelectionOverrides: Readonly<Partial<PairSelectionParameters>>;
  readonly informationGainOverrides?: Readonly<Partial<TopKInformationGainParameters>>;
  readonly balancedEvidenceOverrides?: Readonly<Partial<BalancedEvidenceParameters>>;
  readonly topTwoThompsonOverrides?: Readonly<Partial<TopTwoThompsonParameters>>;
  readonly stopPolicy: BenchmarkStopPolicy;
  readonly minimumDecisions: number;
  readonly maximumDecisions: 'legacy' | 'dynamic' | 'hybrid';
  readonly expectedOverlapEnterThreshold: number;
  readonly expectedOverlapExitThreshold: number;
  readonly stableDecisionCount: number;
}

export interface BenchmarkOptions {
  readonly sessionsPerScenario?: number;
  readonly confidenceSamples?: number;
  readonly fixtures?: readonly RankingFixture[];
  readonly profiles?: readonly HumanProfile[];
  readonly variants?: readonly BenchmarkVariant[];
}

export interface SummaryStats {
  readonly mean: number;
  readonly median: number;
  readonly p90: number;
  readonly minimum: number;
  readonly maximum: number;
}

export interface CarouselEvaluation {
  readonly policy: CarouselPolicyId;
  readonly orderedPhotoIds: readonly PhotoId[];
  readonly selectedGroupIds: readonly string[];
  readonly targetGroupIds: readonly string[];
  readonly targetSize: number;
  readonly uniqueGroupCount: number;
  readonly duplicateGroupSlots: number;
  readonly targetGroupRecall: number;
  readonly targetGroupPrecision: number;
  readonly targetGroupSetExact: boolean;
  readonly hasAtMostOnePhotoPerGroup: boolean;
  readonly hasExpectedSize: boolean;
}

export interface SessionResult {
  readonly fixtureId: string;
  readonly variantId: string;
  readonly profileId: HumanProfileId;
  readonly repetition: number;
  readonly seed: number;
  readonly photoCount: number;
  readonly k: number;
  readonly targetTopK: readonly PhotoId[];
  readonly producedTopK: readonly PhotoId[];
  readonly frontierShortlist: readonly PhotoId[];
  readonly frontierShortlistRecall: number;
  readonly decisionsPresented: number;
  readonly informativeComparisons: number;
  readonly outcomes: Readonly<{
    readonly left: number;
    readonly right: number;
    readonly draw: number;
    readonly skip: number;
  }>;
  readonly contradictoryChoices: number;
  readonly repeatedPairDecisions: number;
  readonly simulatedHumanTimeMs: number;
  readonly expectedTopKOverlapAtStop: number;
  readonly membershipStabilityAtStop: number;
  readonly orderStabilityAtStop: number;
  readonly tierAwareTopKCorrectCount: number;
  readonly canonicalTopKCorrectCount: number;
  readonly topKOverlap: number;
  readonly tierAwareTopKOverlap: number;
  readonly exactCanonicalTopK: boolean;
  readonly atLeastKMinusOneCorrect: boolean;
  readonly top3Recall: number;
  readonly tierTolerantOrderScore: number;
  readonly calibrationError: number;
  readonly signedCalibrationError: number;
  readonly stopReason: 'stable' | 'maximum-reached' | 'no-pair' | 'coverage-incomplete';
  readonly automaticallyStopped: boolean;
  readonly reachedMaximum: boolean;
  readonly manualBoundaryResolutionRequired: boolean;
  readonly maxDecisionViolation: boolean;
  readonly carousel: Readonly<Record<CarouselPolicyId, CarouselEvaluation>>;
}

export interface CalibrationBucket {
  readonly label: string;
  readonly sessions: number;
  readonly meanDeclaredOverlap: number;
  readonly meanEmpiricalOverlap: number;
}

export interface CarouselAggregate {
  readonly targetGroupRecall: SummaryStats;
  readonly targetGroupPrecision: SummaryStats;
  readonly uniqueGroupCount: SummaryStats;
  readonly duplicateGroupSlots: SummaryStats;
  readonly duplicateSelectionRate: number;
  readonly targetGroupSetExactRate: number;
  readonly onePerGroupInvariantRate: number;
  readonly expectedSizeInvariantRate: number;
}

export interface AggregateMetrics {
  readonly id: string;
  readonly variantId: string;
  readonly profileId?: HumanProfileId;
  readonly sessions: number;
  readonly photoCount: SummaryStats;
  readonly decisionsPresented: SummaryStats;
  readonly decisionsPerPhoto: SummaryStats;
  readonly informativeComparisons: SummaryStats;
  readonly simulatedHumanTimeSeconds: SummaryStats;
  readonly topKOverlap: SummaryStats;
  readonly tierAwareTopKOverlap: SummaryStats;
  readonly exactCanonicalTopKRate: number;
  readonly atLeastKMinusOneRate: number;
  readonly top3Recall: SummaryStats;
  readonly frontierShortlistRecall: SummaryStats;
  readonly tierTolerantOrderScore: SummaryStats;
  readonly expectedTopKOverlapAtStop: SummaryStats;
  readonly meanAbsoluteCalibrationError: number;
  readonly meanSignedCalibrationError: number;
  readonly manualBoundaryResolutionRate: number;
  readonly automaticallyStoppedRate: number;
  readonly reachedMaximumRate: number;
  readonly maxDecisionViolationCount: number;
  readonly contradictoryChoiceRate: number;
  readonly repeatedPairDecisionRate: number;
  readonly outcomeRates: Readonly<{
    readonly left: number;
    readonly right: number;
    readonly draw: number;
    readonly skip: number;
  }>;
  readonly calibrationBuckets: readonly CalibrationBucket[];
  readonly carousel: Readonly<Record<CarouselPolicyId, CarouselAggregate>>;
}

export interface GateEvaluation {
  readonly variantId: string;
  readonly expectedOverlapAtLeastPointNine: boolean;
  readonly atLeastKMinusOneAtLeast95Percent: boolean;
  readonly top3RecallAtLeast95Percent: boolean;
  readonly medianDecisionsPerPhotoAtMostOnePointTwentyFive: boolean;
  readonly p90DecisionsPerPhotoAtMostOnePointSeventyFive: boolean;
  readonly noMaximumDecisionViolations: boolean;
  readonly allHypothesesPassed: boolean;
}

export interface BenchmarkReport {
  readonly schemaVersion: 1;
  readonly description: string;
  readonly settings: Readonly<{
    readonly sessionsPerScenario: number;
    readonly confidenceSamples: number;
    readonly fixtureIds: readonly string[];
    readonly fixtureDefinitions: readonly Readonly<{
      readonly id: string;
      readonly k: number;
      readonly tiers: readonly (readonly PhotoId[])[];
      readonly groups: readonly SyntheticGroup[];
    }>[];
    readonly profileIds: readonly HumanProfileId[];
    readonly profileDefinitions: readonly HumanProfile[];
    readonly variantIds: readonly string[];
    readonly variantDefinitions: readonly BenchmarkVariant[];
  }>;
  readonly sessions: readonly SessionResult[];
  readonly aggregates: readonly AggregateMetrics[];
  readonly gateEvaluations: readonly GateEvaluation[];
  readonly paretoFrontierVariantIds: readonly string[];
}
