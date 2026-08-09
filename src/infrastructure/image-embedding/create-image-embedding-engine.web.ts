import type { ImageEmbeddingEngine } from '../../domain/contracts';
import { WebImageEmbeddingEngine } from './web/web-image-embedding-engine';

export async function createImageEmbeddingEngine(): Promise<ImageEmbeddingEngine> {
  return new WebImageEmbeddingEngine();
}
