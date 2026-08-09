import type { ImageEmbeddingEngine, PhotoAsset } from '../../../domain/contracts';
import { VisualAnalysisError } from '../errors';
import { VisualAnalysisRunner } from '../analysis-runner';

const photos: readonly PhotoAsset[] = [
  { id: 'a', uri: 'file://a.jpg' },
  { id: 'b', uri: 'file://b.jpg' },
  { id: 'c', uri: 'file://c.jpg' },
];

function embedding(value = 1): readonly number[] {
  return Object.freeze(Array.from({ length: 576 }, (_, index) => index === 0 ? value : 0));
}

describe('VisualAnalysisRunner', () => {
  it('processes exactly one photo at a time, reports real progress and disposes the engine', async () => {
    let concurrent = 0;
    let maximumConcurrent = 0;
    const calls: string[] = [];
    const engine: ImageEmbeddingEngine = {
      initialize: jest.fn(async () => undefined),
      embed: jest.fn(async (photo) => {
        concurrent += 1;
        maximumConcurrent = Math.max(maximumConcurrent, concurrent);
        calls.push(photo.id);
        await Promise.resolve();
        concurrent -= 1;
        return embedding();
      }),
      dispose: jest.fn(async () => undefined),
    };
    const progress: number[] = [];
    const runner = new VisualAnalysisRunner(async () => engine);

    const result = await runner.analyze(photos, ({ completed }) => progress.push(completed));

    expect(calls).toEqual(['a', 'b', 'c']);
    expect(maximumConcurrent).toBe(1);
    expect(progress).toEqual([0, 0, 1, 1, 2, 2, 3]);
    expect(result.processedPhotoIds).toEqual(['a', 'b', 'c']);
    expect(result.embeddings.size).toBe(3);
    expect(engine.dispose).toHaveBeenCalledTimes(1);
  });

  it('clears partial embeddings and disposes resources after inference failure', async () => {
    const engine: ImageEmbeddingEngine = {
      initialize: async () => undefined,
      embed: jest.fn(async (photo) => {
        if (photo.id === 'b') throw new VisualAnalysisError('inference', 'failed');
        return embedding();
      }),
      dispose: jest.fn(async () => undefined),
    };
    const runner = new VisualAnalysisRunner(async () => engine);

    await expect(runner.analyze(photos, () => undefined)).rejects.toMatchObject({ code: 'inference' });
    expect(runner.embeddings.size).toBe(0);
    expect(engine.dispose).toHaveBeenCalledTimes(1);
  });

  it('honors cancellation between sequential photos and performs cleanup', async () => {
    let releaseFirst: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const firstEmbedding = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const embeddingStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const engine: ImageEmbeddingEngine = {
      initialize: async () => undefined,
      embed: jest.fn(async () => { markStarted?.(); await firstEmbedding; return embedding(); }),
      dispose: jest.fn(async () => undefined),
    };
    const runner = new VisualAnalysisRunner(async () => engine);
    const analysis = runner.analyze(photos, () => undefined);
    await embeddingStarted;
    runner.cancel();
    releaseFirst?.();

    await expect(analysis).rejects.toMatchObject({ code: 'cancelled' });
    expect(engine.embed).toHaveBeenCalledTimes(1);
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    expect(runner.embeddings.size).toBe(0);
  });
});
