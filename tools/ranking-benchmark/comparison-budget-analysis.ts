import type { BudgetObservation } from './comparison-budget-study';

/** Bounds for strict, noiseless, transitive preferences; not a PhotoRank guarantee. */
export function noiselessComparisonBounds(n: number, k: number) {
  if (!Number.isInteger(n) || n < 2 || !Number.isInteger(k) || k < 1 || k > n) {
    throw new RangeError('Expected N >= 2 and 1 <= K <= N.');
  }
  const minority = Math.min(k, n - k);
  let logCombinations = 0;
  for (let index = 1; index <= minority; index += 1) logCombinations += Math.log2((n - minority + index) / index);
  let logPermutations = 0;
  for (let index = 0; index < k; index += 1) logPermutations += Math.log2(n - index);
  let logFactorial = 0;
  for (let index = 2; index <= k; index += 1) logFactorial += Math.log2(index);
  const sortingDepth = Math.ceil(Math.log2(k));
  return {
    membershipLowerBound: k === n ? 0 : Math.max(n - 1, Math.ceil(logCombinations)),
    // Extract either the K best or N-K worst using a balanced tournament tree.
    membershipTournamentUpperBound: k === n ? 0 : n - 1 + (minority - 1) * Math.ceil(Math.log2(n)),
    orderedTopKLowerBound: Math.max(n - 1, Math.ceil(logPermutations)),
    // These two apply to K already selected photos, with no prior comparison information.
    selectedKOrderingLowerBound: Math.ceil(logFactorial),
    selectedKMergeSortUpperBound: k * sortingDepth - 2 ** sortingDepth + 1,
  };
}

const METRICS = ['coverage', 'overlap', 'boundaryRecovery', 'exactSelection', 'orderConcordance', 'exactOrder'] as const;

export function summarizeBudgetObservations(observations: readonly BudgetObservation[]) {
  const groups = new Map<string, BudgetObservation[]>();
  for (const observation of observations) {
    const key = JSON.stringify([observation.n, observation.k, observation.kind, observation.profile, observation.decisions]);
    const values = groups.get(key) ?? [];
    values.push(observation);
    groups.set(key, values);
  }
  const points = [...groups.values()].map((values) => {
    const first = values[0]!;
    const means = Object.fromEntries(METRICS.map((metric) => [metric,
      values.reduce((total, value) => total + value[metric], 0) / values.length,
    ])) as Record<(typeof METRICS)[number], number>;
    return { n: first.n, k: first.k, kind: first.kind, profile: first.profile,
      decisions: first.decisions, sessions: values.length, ...means };
  }).sort((left, right) => left.n - right.n || left.k - right.k
    || left.kind.localeCompare(right.kind) || left.profile.localeCompare(right.profile) || left.decisions - right.decisions);
  const curves = new Map<string, typeof points>();
  for (const point of points) {
    const key = JSON.stringify([point.n, point.k, point.kind, point.profile]);
    const curve = curves.get(key) ?? [];
    curve.push(point);
    curves.set(key, curve);
  }
  const summaries = [...curves.values()].map((curve) => {
    const first = curve[0]!;
    const findSustained = (target: number, includeOrdering: boolean): number | null => {
      if (first.k === first.n && !includeOrdering) return 0;
      const selected = curve.find((point, index) => point.coverage === 1
        && curve.slice(index).every((later) => later.boundaryRecovery + 1e-12 >= target
          && (!includeOrdering || later.orderConcordance + 1e-12 >= target)));
      return selected?.decisions ?? null;
    };
    return { n: first.n, k: first.k, kind: first.kind, profile: first.profile,
      membership80: findSustained(0.8, false), membership90: findSustained(0.9, false),
      membership95: findSustained(0.95, false), membershipAndPairOrder90: findSustained(0.9, true),
      atMaximumBudget: curve.at(-1)!, ...noiselessComparisonBounds(first.n, first.k) };
  });
  return { summaries, points };
}
