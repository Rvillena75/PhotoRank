import { createSeededRandom } from '../../../src/domain/confidence';
import { HUMAN_PROFILES, HumanDecisionSimulator } from '../human-simulator';
import { buildBudgetFixture, runBudgetStudy, scoreBudgetSelection } from '../comparison-budget-study';
import type { BudgetObservation } from '../comparison-budget-study';
import { noiselessComparisonBounds, summarizeBudgetObservations } from '../comparison-budget-analysis';

describe('comparison budget study', () => {
  it('keeps photo identity independent of preference and normalizes the utility range across N', () => {
    const small = buildBudgetFixture(10, 3, 7, 'strict');
    const large = buildBudgetFixture(50, 5, 7, 'strict');
    expect(small.fixture.targetTopK).not.toEqual(small.fixture.photoIds.slice(0, 3));
    for (const { fixture, coordinates } of [small, large]) {
      expect(Math.min(...Object.values(coordinates))).toBe(0);
      expect(Math.max(...Object.values(coordinates))).toBe(9);
      expect(new Set(fixture.tiers.flat())).toEqual(new Set(fixture.photoIds));
    }
    const differentK = buildBudgetFixture(10, 5, 7, 'strict');
    expect(differentK.fixture.tiers).toEqual(small.fixture.tiers);
  });

  it('does not mistake high overlap near K=N for successfully identifying the excluded photo', () => {
    const { fixture } = buildBudgetFixture(20, 19, 3, 'strict');
    const worstNineteen = fixture.tiers.slice(1).flat();
    const score = scoreBudgetSelection(worstNineteen, fixture);
    expect(score.overlap).toBeCloseTo(18 / 19);
    expect(score.boundaryRecovery).toBe(0);
    expect(score.exactSelection).toBe(0);
    const all = buildBudgetFixture(20, 20, 3, 'strict').fixture;
    expect(scoreBudgetSelection(all.targetTopK, all).boundaryRecovery).toBe(1);
  });

  it('limits credit to each target tier and measures ordering separately from membership', () => {
    const fixture = buildBudgetFixture(20, 3, 5, 'tiers').fixture;
    const firstTier = fixture.tiers[0]!;
    const secondTier = fixture.tiers[1]!;
    const equivalent = [firstTier[0]!, firstTier[1]!, secondTier[1]!];
    expect(scoreBudgetSelection(equivalent, fixture).exactSelection).toBe(1);
    const missingFavorite = [firstTier[0]!, secondTier[0]!, secondTier[1]!];
    expect(scoreBudgetSelection(missingFavorite, fixture).overlap).toBeCloseTo(2 / 3);
    const reversed = [...equivalent].reverse();
    const score = scoreBudgetSelection(reversed, fixture);
    expect(score.exactSelection).toBe(1);
    expect(score.exactOrder).toBe(0);
    expect(score.orderConcordance).toBeLessThan(1);
  });

  it('preserves the original simulator when no alternative coordinates are supplied', () => {
    const fixture = buildBudgetFixture(10, 3, 2, 'strict').fixture;
    const profile = HUMAN_PROFILES[1]!;
    const original = new HumanDecisionSimulator(profile, fixture, createSeededRandom(44));
    const explicit = new HumanDecisionSimulator(profile, fixture, createSeededRandom(44), fixture.tierByPhotoId);
    for (let index = 0; index < 20; index += 1) {
      const pair = { leftPhotoId: fixture.photoIds[index % 10]!, rightPhotoId: fixture.photoIds[(index + 1) % 10]!, stage: 'adaptive' as const };
      expect(original.choose(pair)).toEqual(explicit.choose(pair));
    }
  });

  it('produces deterministic fixed-budget trajectories, including K=1 and K=N', () => {
    const options = { photoCounts: [2], repetitions: 1, kinds: ['strict' as const], profiles: HUMAN_PROFILES.slice(0, 1) };
    const first = runBudgetStudy(options);
    expect(first).toEqual(runBudgetStudy(options));
    expect(first.sessions).toBe(2);
    expect(first.observations.some((row) => row.k === 1)).toBe(true);
    expect(first.observations.some((row) => row.k === 2)).toBe(true);
    expect(first.observations.every((row) => row.boundaryRecovery >= 0 && row.boundaryRecovery <= 1)).toBe(true);
    expect(first.observations.filter((row) => row.decisions === 8)).toHaveLength(2);
    expect(summarizeBudgetObservations(first.observations).summaries.find((row) => row.k === 2)?.membership90).toBe(0);
  });

  it('distinguishes theoretical selection bounds from ordering and handles K=1 and K=N', () => {
    expect(noiselessComparisonBounds(20, 1)).toMatchObject({ membershipLowerBound: 19, membershipTournamentUpperBound: 19 });
    expect(noiselessComparisonBounds(20, 5)).toMatchObject({
      membershipLowerBound: 19, membershipTournamentUpperBound: 39,
      selectedKOrderingLowerBound: 7, selectedKMergeSortUpperBound: 8,
    });
    expect(noiselessComparisonBounds(20, 19).membershipTournamentUpperBound).toBe(19);
    expect(noiselessComparisonBounds(20, 20).membershipTournamentUpperBound).toBe(0);
    expect(noiselessComparisonBounds(20, 20).orderedTopKLowerBound).toBeGreaterThan(0);
    expect(() => noiselessComparisonBounds(20, 21)).toThrow(RangeError);
  });

  it('requires a sustained target rather than reporting an isolated quality spike as sufficient', () => {
    const observations: BudgetObservation[] = [0.95, 0.8, 0.9].map((quality, index) => ({
      n: 10, k: 3, kind: 'strict', profile: 'consistent', repetition: 0,
      decisions: (index + 1) * 10, coverage: 1, overlap: quality,
      boundaryRecovery: quality, exactSelection: 0, orderConcordance: 0.5, exactOrder: 0,
    }));
    const summary = summarizeBudgetObservations(observations).summaries[0]!;
    expect(summary.membership90).toBe(30);
    expect(summary.membership95).toBeNull();
    expect(summary.membershipAndPairOrder90).toBeNull();
  });
});
