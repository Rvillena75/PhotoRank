import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSeededRandom, seedFromText } from '../../src/domain/confidence';
import { AdaptivePairSelectionEngine } from '../../src/domain/pair-selection';
import { applyComparison, createRankingSession, getTopK } from '../../src/domain/rating';
import { TsTrueSkillRatingEngine } from '../../src/infrastructure/rating';
import { buildBudgetFixture, scoreBudgetSelection } from './comparison-budget-study';
import type { AlbumKind } from './comparison-budget-study';
import { HUMAN_PROFILES, HumanDecisionSimulator } from './human-simulator';

const verifyOnly = process.argv.includes('--verify-first');
const end = verifyOnly ? 21 : 100;
const engine = new TsTrueSkillRatingEngine();
const selector = new AdaptivePairSelectionEngine();
const rows = [];
for (const kind of ['strict', 'tiers'] as const satisfies readonly AlbumKind[]) {
  for (const profile of HUMAN_PROFILES) {
    for (let repetition = 20; repetition < end; repetition += 1) {
      const { fixture, coordinates } = buildBudgetFixture(20, 5, repetition, kind);
      const seed = seedFromText(`budget-responses|20|${profile.id}|${repetition}`);
      const simulator = new HumanDecisionSimulator(profile, fixture, createSeededRandom(seed), coordinates);
      let session = createRankingSession(fixture.photoIds, engine);
      for (let decision = 1; decision <= 80; decision += 1) {
        const pair = selector.selectNextPair({ ...session, k: 5 });
        if (!pair) throw new Error('Expected a valid comparison pair.');
        session = applyComparison(session, {
          id: `${seed}-${decision}`, leftPhotoId: pair.leftPhotoId, rightPhotoId: pair.rightPhotoId,
          outcome: simulator.choose(pair).outcome, createdAt: decision,
        }, engine);
        if (decision % 5 === 0) rows.push({ n: 20, k: 5, kind, profile: profile.id, repetition,
          decisions: decision, ...scoreBudgetSelection(getTopK(session, 5), fixture) });
      }
    }
  }
}
const output = resolve('local-data/ranking/comparison-budget-study/validation-20-5.json');
if (verifyOnly) {
  const saved = JSON.parse(readFileSync(output, 'utf8')) as { rows: typeof rows };
  assert.deepEqual(rows, saved.rows.filter((row) => row.repetition === 20));
  process.stdout.write('Verified eight independent validation sessions against the saved evidence.\n');
} else {
  writeFileSync(output, `${JSON.stringify({ repetitions: 80, repetitionRange: [20, 99], sessions: 640, rows }, null, 2)}\n`);
  process.stdout.write(`Saved 640 validation sessions to ${output}\n`);
}
