import type { RandomSource } from '../../src/domain/confidence';
import type { ComparisonOutcome } from '../../src/domain/rating';
import type { SelectedPair } from '../../src/domain/pair-selection';
import type { HumanProfile, RankingFixture } from './types';

export interface SimulatedDecision {
  readonly outcome: ComparisonOutcome;
  readonly responseTimeMs: number;
  readonly wasContradictory: boolean;
  readonly wasRepeatedPair: boolean;
}

export const HUMAN_PROFILES: readonly HumanProfile[] = Object.freeze([
  Object.freeze({
    id: 'deterministic',
    label: 'Determinista',
    description: 'Siempre elige la foto del tier superior y empata dentro del mismo tier.',
    noiseScale: 0.01,
    baseDrawProbability: 0,
    closeDrawBoost: 0,
    baseSkipProbability: 0,
    closeSkipBoost: 0,
    contradictionProbability: 0,
    repeatFlipProbability: 0,
    leftSideBias: 0,
    decisionTimeMs: Object.freeze({ base: 2_200, jitter: 150 }),
    deterministicTies: true,
  }),
  Object.freeze({
    id: 'consistent',
    label: 'Consistente',
    description: 'Tiene ruido bajo, algunos empates y contradicciones ocasionales.',
    noiseScale: 0.55,
    baseDrawProbability: 0.04,
    closeDrawBoost: 0.16,
    baseSkipProbability: 0.01,
    closeSkipBoost: 0.02,
    contradictionProbability: 0.02,
    repeatFlipProbability: 0.05,
    leftSideBias: 0.01,
    decisionTimeMs: Object.freeze({ base: 3_100, jitter: 650 }),
    deterministicTies: false,
  }),
  Object.freeze({
    id: 'habitual',
    label: 'Habitual',
    description: 'Compara con criterio razonable, pero repite elecciones y cambia de opinión.',
    noiseScale: 1.1,
    baseDrawProbability: 0.08,
    closeDrawBoost: 0.22,
    baseSkipProbability: 0.035,
    closeSkipBoost: 0.045,
    contradictionProbability: 0.1,
    repeatFlipProbability: 0.16,
    leftSideBias: 0.04,
    decisionTimeMs: Object.freeze({ base: 4_100, jitter: 1_000 }),
    deterministicTies: false,
  }),
  Object.freeze({
    id: 'ambiguous',
    label: 'Muy ambiguo',
    description: 'Duda ante fotos cercanas, usa saltar y presenta contradicciones frecuentes.',
    noiseScale: 1.8,
    baseDrawProbability: 0.14,
    closeDrawBoost: 0.3,
    baseSkipProbability: 0.07,
    closeSkipBoost: 0.08,
    contradictionProbability: 0.16,
    repeatFlipProbability: 0.24,
    leftSideBias: 0.08,
    decisionTimeMs: Object.freeze({ base: 5_200, jitter: 1_600 }),
    deterministicTies: false,
  }),
]);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const exponent = Math.exp(-value);
    return 1 / (1 + exponent);
  }
  const exponent = Math.exp(value);
  return exponent / (1 + exponent);
}

function pairKey(leftPhotoId: string, rightPhotoId: string): string {
  return [leftPhotoId, rightPhotoId].sort((left, right) => left.localeCompare(right)).join('\u0001');
}

function probabilityForCloseOutcome(base: number, boost: number, absoluteTierDifference: number): number {
  const closeness = Math.exp(-absoluteTierDifference / 1.25);
  return clamp(base + boost * closeness, 0, 0.95);
}

export class HumanDecisionSimulator {
  private readonly previousOutcomes = new Map<string, ComparisonOutcome>();

  constructor(
    private readonly profile: HumanProfile,
    private readonly fixture: RankingFixture,
    private readonly random: RandomSource,
    private readonly preferenceCoordinates: Readonly<Record<string, number>> = fixture.tierByPhotoId,
  ) {}

  choose(pair: SelectedPair): SimulatedDecision {
    const leftTier = this.preferenceCoordinates[pair.leftPhotoId];
    const rightTier = this.preferenceCoordinates[pair.rightPhotoId];
    if (leftTier === undefined || rightTier === undefined) {
      throw new Error('Synthetic simulator received a photo outside its fixture.');
    }

    const key = pairKey(pair.leftPhotoId, pair.rightPhotoId);
    const previousOutcome = this.previousOutcomes.get(key);
    const wasRepeatedPair = previousOutcome !== undefined;
    const absoluteTierDifference = Math.abs(leftTier - rightTier);
    const leftAdvantage = rightTier - leftTier;
    const isEquivalentTier = absoluteTierDifference === 0;

    // Consume a fixed number of variates on every decision. Candidate variants
    // therefore see common random numbers by decision index even when their
    // selected pairs take different outcome branches.
    const skipRandom = this.random.next();
    const drawRandom = this.random.next();
    const preferenceRandom = this.random.next();
    const contradictionRandom = this.random.next();
    const repeatFlipRandom = this.random.next();
    const timeRandom = this.random.next();

    let outcome: ComparisonOutcome;
    if (this.profile.deterministicTies && isEquivalentTier) {
      outcome = { type: 'draw' };
    } else if (skipRandom < probabilityForCloseOutcome(
      this.profile.baseSkipProbability,
      this.profile.closeSkipBoost,
      absoluteTierDifference,
    )) {
      outcome = { type: 'skip' };
    } else if (drawRandom < probabilityForCloseOutcome(
      this.profile.baseDrawProbability,
      this.profile.closeDrawBoost,
      absoluteTierDifference,
    )) {
      outcome = { type: 'draw' };
    } else {
      const preferenceProbability = this.profile.deterministicTies && !isEquivalentTier
        ? (leftAdvantage > 0 ? 1 : 0)
        : clamp(
          sigmoid(leftAdvantage / this.profile.noiseScale) + this.profile.leftSideBias,
          0.01,
          0.99,
        );
      const prefersLeft = preferenceRandom < preferenceProbability;
      outcome = { type: prefersLeft ? 'left' : 'right' };

      if (contradictionRandom < this.profile.contradictionProbability) {
        outcome = { type: outcome.type === 'left' ? 'right' : 'left' };
      }

      if (previousOutcome && previousOutcome.type !== 'draw' && previousOutcome.type !== 'skip'
        && repeatFlipRandom < this.profile.repeatFlipProbability) {
        outcome = { type: outcome.type === 'left' ? 'right' : 'left' };
      }
    }

    this.previousOutcomes.set(key, outcome);
    const wasContradictory = leftAdvantage > 0
      ? outcome.type === 'right'
      : leftAdvantage < 0 ? outcome.type === 'left' : false;
    const responseTimeMs = Math.max(
      250,
      this.profile.decisionTimeMs.base
        + this.profile.decisionTimeMs.jitter * (2 * timeRandom - 1),
    );

    return Object.freeze({
      outcome,
      responseTimeMs,
      wasContradictory,
      wasRepeatedPair,
    });
  }
}
