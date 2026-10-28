import { createSeededRandom, seedFromText } from '../../src/domain/confidence';
import { AdaptivePairSelectionEngine } from '../../src/domain/pair-selection';
import { DEFAULT_RANKING_CONFIG } from '../../src/domain/ranking-config';
import { applyComparison, createRankingSession, getTopK } from '../../src/domain/rating';
import { TsTrueSkillRatingEngine } from '../../src/infrastructure/rating';
import { HUMAN_PROFILES, HumanDecisionSimulator } from './human-simulator';
import type { HumanProfile, RankingFixture } from './types';

export type AlbumKind = 'strict' | 'tiers';

export function buildBudgetFixture(n: number, k: number, repetition: number, kind: AlbumKind): Readonly<{
  fixture: RankingFixture;
  coordinates: Readonly<Record<string, number>>;
}> {
  if (!Number.isInteger(n) || n < 2 || !Number.isInteger(k) || k < 1 || k > n) {
    throw new RangeError('Expected N >= 2 and 1 <= K <= N.');
  }
  const photoIds = Array.from({ length: n }, (_, index) => `photo-${String(index).padStart(3, '0')}`);
  const ranked = [...photoIds];
  // Layout is independent of K and the response profile, allowing paired comparisons.
  const random = createSeededRandom(seedFromText(`budget-layout|${n}|${repetition}`));
  for (let index = ranked.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random.next() * (index + 1));
    [ranked[index], ranked[other]] = [ranked[other]!, ranked[index]!];
  }
  const tierCount = kind === 'strict' ? n : Math.min(10, n);
  const tiers = Array.from({ length: tierCount }, (_, index) => ranked.filter(
    (_, rank) => Math.floor(rank * tierCount / n) === index,
  ));
  const tierByPhotoId = Object.fromEntries(tiers.flatMap((tier, index) => tier.map((id) => [id, index])));
  const coordinates = Object.fromEntries(photoIds.map((id) => [id, 9 * tierByPhotoId[id]! / (tierCount - 1)]));
  const groups = photoIds.map((id) => ({ id: `group-${id}`, photoIds: [id] }));
  const acceptable = (size: number) => {
    const selected: string[] = [];
    for (const tier of tiers) {
      if (selected.length >= size) break;
      selected.push(...tier);
    }
    return selected;
  };
  const fixture: RankingFixture = {
    id: `budget-${n}-${k}-${kind}-${repetition}`, k, photoIds, tiers, tierByPhotoId,
    targetRankByPhotoId: Object.fromEntries(ranked.map((id, rank) => [id, rank])),
    targetTopK: ranked.slice(0, k), acceptableTopKPhotoIds: acceptable(k),
    acceptableTop3PhotoIds: acceptable(Math.min(3, k)), groups,
    groupByPhotoId: Object.fromEntries(groups.map((group) => [group.photoIds[0]!, group.id])),
    targetCarouselGroupIds: ranked.slice(0, k).map((id) => `group-${id}`),
  };
  return { fixture, coordinates };
}

export function scoreBudgetSelection(ids: readonly string[], fixture: RankingFixture): Readonly<{
  overlap: number;
  boundaryRecovery: number;
  exactSelection: number;
  orderConcordance: number;
  exactOrder: number;
}> {
  const chosen = new Set(ids);
  if (ids.length !== fixture.k || chosen.size !== ids.length
    || ids.some((id) => !fixture.photoIds.includes(id))) throw new Error('Expected exactly K session photos.');
  let remaining = fixture.k;
  let correct = 0;
  for (const tier of fixture.tiers) {
    if (remaining <= 0) break;
    const capacity = Math.min(remaining, tier.length);
    correct += Math.min(capacity, tier.filter((id) => chosen.has(id)).length);
    remaining -= capacity;
  }
  let ordered = 0;
  let pairs = 0;
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      pairs += 1;
      if (fixture.tierByPhotoId[ids[left]!]! <= fixture.tierByPhotoId[ids[right]!]!) ordered += 1;
    }
  }
  const exactSelection = Number(correct === fixture.k);
  const minoritySize = Math.min(fixture.k, fixture.photoIds.length - fixture.k);
  return {
    overlap: correct / fixture.k,
    // Selecting K and rejecting N-K are the same boundary decision. This avoids
    // rewarding an uninformed 19-of-20 selection for its inevitable high overlap.
    boundaryRecovery: minoritySize === 0 ? 1 : 1 - (fixture.k - correct) / minoritySize,
    exactSelection,
    orderConcordance: pairs === 0 ? 1 : ordered / pairs,
    exactOrder: Number(exactSelection === 1 && ordered === pairs),
  };
}

export interface BudgetObservation {
  readonly n: number;
  readonly k: number;
  readonly kind: AlbumKind;
  readonly profile: string;
  readonly repetition: number;
  readonly decisions: number;
  readonly coverage: number;
  readonly overlap: number;
  readonly boundaryRecovery: number;
  readonly exactSelection: number;
  readonly orderConcordance: number;
  readonly exactOrder: number;
}

export interface BudgetStudyOptions {
  readonly photoCounts?: readonly number[];
  readonly repetitions?: number;
  readonly kinds?: readonly AlbumKind[];
  readonly profiles?: readonly HumanProfile[];
  readonly onProgress?: (message: string) => void;
}

export function runBudgetStudy(options: BudgetStudyOptions = {}) {
  const photoCounts = options.photoCounts ?? [10, 20, 30, 50];
  const repetitions = options.repetitions ?? 20;
  const kinds = options.kinds ?? ['strict', 'tiers'];
  const profiles = options.profiles ?? HUMAN_PROFILES;
  if (!Number.isInteger(repetitions) || repetitions < 1) throw new RangeError('Expected positive repetitions.');
  const engine = new TsTrueSkillRatingEngine();
  const selector = new AdaptivePairSelectionEngine();
  const observations: BudgetObservation[] = [];
  let sessions = 0;
  for (const n of photoCounts) {
    const kValues = [...new Set([1, 3, 5, 10, Math.floor(n / 2), n - 1, n])].filter((k) => k <= n);
    for (const k of kValues) {
      for (const kind of kinds) {
        for (const profile of profiles) {
          for (let repetition = 0; repetition < repetitions; repetition += 1) {
            const { fixture, coordinates } = buildBudgetFixture(n, k, repetition, kind);
            const seed = seedFromText(`budget-responses|${n}|${profile.id}|${repetition}`);
            const simulator = new HumanDecisionSimulator(profile, fixture, createSeededRandom(seed), coordinates);
            let session = createRankingSession(fixture.photoIds, engine);
            const interval = Math.max(1, Math.ceil(n / 4));
            const checkpoints = new Set([0, Math.ceil(n / 2), n, 2 * n, 3 * n, 4 * n]);
            for (let count = interval; count <= 4 * n; count += interval) checkpoints.add(count);
            const observe = () => observations.push({
              n, k, kind, profile: profile.id, repetition, decisions: session.history.length,
              coverage: session.photoIds.filter((id) => session.ratings[id]!.matches > 0).length / n,
              ...scoreBudgetSelection(getTopK(session, k), fixture),
            });
            observe();
            // Fixed-budget trajectories deliberately continue past an automatic
            // stop to measure the marginal value of more actual responses.
            for (let decision = 1; decision <= 4 * n; decision += 1) {
              const pair = selector.selectNextPair({ ...session, k });
              if (!pair) throw new Error('No valid pair before the fixed budget.');
              const outcome = simulator.choose(pair).outcome;
              session = applyComparison(session, {
                id: `${seed}-${decision}`, leftPhotoId: pair.leftPhotoId, rightPhotoId: pair.rightPhotoId,
                outcome, createdAt: decision,
              }, engine);
              if (checkpoints.has(decision)) observe();
            }
            sessions += 1;
          }
        }
      }
      options.onProgress?.(`N=${n}, K=${k}: ${sessions} sessions completed.`);
    }
  }
  return {
    schemaVersion: 1,
    settings: { photoCounts, repetitions, kinds, profiles, config: DEFAULT_RANKING_CONFIG,
      preferenceCoordinateRange: [0, 9], maximumDecisionsMultiplier: 4 },
    sessions, observations,
  };
}
