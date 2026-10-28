import { BENCHMARK_VARIANTS, runBenchmark } from '../runner';
import { HUMAN_PROFILES } from '../human-simulator';
import { SYNTHETIC_FIXTURES } from '../fixtures';

describe('synthetic ranking benchmark', () => {
  it('uses names only and produces deterministic sessions and aggregates', () => {
    const options = {
      sessionsPerScenario: 1,
      confidenceSamples: 40,
      fixtures: SYNTHETIC_FIXTURES.slice(0, 1),
      profiles: HUMAN_PROFILES.slice(0, 2),
      variants: BENCHMARK_VARIANTS.slice(0, 3),
    } as const;
    const first = runBenchmark(options);
    const second = runBenchmark(options);

    expect(first).toEqual(second);
    expect(first.sessions).toHaveLength(6);
    expect(first.sessions.every(({ targetTopK, producedTopK }) => (
      targetTopK.every((photoId) => photoId.includes('synthetic-20-photo-'))
      && producedTopK.every((photoId) => photoId.includes('synthetic-20-photo-'))
    ))).toBe(true);
    expect(first.sessions.every(({ carousel }) => (
      carousel['top-k'] && carousel['group-diverse-reference']
    ))).toBe(true);
    expect(first.sessions.every(({ top3Recall, frontierShortlistRecall }) => (
      top3Recall >= 0 && top3Recall <= 1
      && frontierShortlistRecall >= 0 && frontierShortlistRecall <= 1
    ))).toBe(true);
    const seedsByScenario = new Map<string, Set<number>>();
    for (const session of first.sessions) {
      const key = `${session.fixtureId}:${session.profileId}:${session.repetition}`;
      const seeds = seedsByScenario.get(key) ?? new Set<number>();
      seeds.add(session.seed);
      seedsByScenario.set(key, seeds);
    }
    expect([...seedsByScenario.values()].every((seeds) => seeds.size === 1)).toBe(true);
    expect(first.aggregates.length).toBe(9);
  });

  it('keeps the synthetic ground truth tier-aware at the K boundary', () => {
    const fixture = SYNTHETIC_FIXTURES[0];
    if (!fixture) throw new Error('Expected a synthetic fixture.');

    expect(fixture.targetTopK).toHaveLength(fixture.k);
    expect(fixture.acceptableTopKPhotoIds.length).toBeGreaterThanOrEqual(fixture.k);
    expect(new Set(fixture.photoIds).size).toBe(fixture.photoIds.length);
    expect(fixture.targetTopK).not.toEqual(fixture.photoIds.slice(0, fixture.k));
    expect(fixture.groups.flatMap(({ photoIds }) => photoIds).sort()).toEqual([...fixture.photoIds].sort());
  });

  it('measures favorite recall anywhere inside the produced Top K, not exact internal order', () => {
    const report = runBenchmark({
      sessionsPerScenario: 1,
      confidenceSamples: 40,
      fixtures: SYNTHETIC_FIXTURES.slice(0, 1),
      profiles: HUMAN_PROFILES.slice(0, 1),
      variants: BENCHMARK_VARIANTS.filter(({ id }) => id === 'current-one-coverage'),
    });
    const session = report.sessions[0];
    const fixture = SYNTHETIC_FIXTURES[0];
    if (!session || !fixture) throw new Error('Expected one benchmark session.');
    const firstTierPhoto = fixture.tiers[0]?.[0];
    const secondTierPhoto = fixture.tiers[1]?.[0];
    const boundaryTier = fixture.tiers[2] ?? [];
    const expectedCorrect = Number(firstTierPhoto !== undefined && session.producedTopK.includes(firstTierPhoto))
      + Number(secondTierPhoto !== undefined && session.producedTopK.includes(secondTierPhoto))
      + Math.min(1, boundaryTier.filter((photoId) => session.producedTopK.includes(photoId)).length);
    expect(session.top3Recall).toBe(expectedCorrect / 3);
  });

  it('executes every experimental selector and rating candidate through the shared runner', () => {
    const candidateIds = new Set([
      'top-k-information-gain-90',
      'bradley-terry-frontier-90',
      'balanced-evidence-2-frontier-90',
      'top-two-thompson-90',
    ]);
    const report = runBenchmark({
      sessionsPerScenario: 1,
      confidenceSamples: 20,
      fixtures: SYNTHETIC_FIXTURES.slice(0, 1),
      profiles: HUMAN_PROFILES.slice(0, 1),
      variants: BENCHMARK_VARIANTS.filter(({ id }) => candidateIds.has(id)),
    });

    expect(report.sessions).toHaveLength(candidateIds.size);
    expect(report.sessions.every(({ decisionsPresented, topKOverlap }) => (
      decisionsPresented > 0 && topKOverlap >= 0 && topKOverlap <= 1
    ))).toBe(true);
  });
});
