import type { ImageEmbeddingEngine } from '../../domain/contracts';
import { NativeImageEmbeddingEngine } from './native/native-image-embedding-engine';

export async function createImageEmbeddingEngine(): Promise<ImageEmbeddingEngine> {
  return new NativeImageEmbeddingEngine();
}
