import type { ImageEmbeddingEngine } from '../../domain/contracts';

export async function createImageEmbeddingEngine(): Promise<ImageEmbeddingEngine> {
  throw new Error('A platform-specific ImageEmbeddingEngine was not resolved.');
}
