import type { ImageEmbeddingEngine, PhotoAsset, PhotoId } from '../../domain/contracts';
import { VisualAnalysisError } from './errors';

export interface VisualAnalysisProgress {
  readonly completed: number;
  readonly total: number;
  readonly currentPhotoId?: PhotoId;
}

export interface VisualAnalysisResult {
  readonly embeddings: ReadonlyMap<PhotoId, readonly number[]>;
  readonly processedPhotoIds: readonly PhotoId[];
}

export type ImageEmbeddingEngineFactory = () => Promise<ImageEmbeddingEngine>;

export class VisualAnalysisRunner {
  private cancellationRequested = false;
  private active = false;
  private storedEmbeddings = new Map<PhotoId, readonly number[]>();

  constructor(private readonly createEngine: ImageEmbeddingEngineFactory) {}

  cancel(): void {
    this.cancellationRequested = true;
  }

  clear(): void {
    if (this.active) this.cancel();
    this.storedEmbeddings.clear();
  }

  get embeddings(): ReadonlyMap<PhotoId, readonly number[]> {
    return this.storedEmbeddings;
  }

  async analyze(
    photos: readonly PhotoAsset[],
    onProgress: (progress: VisualAnalysisProgress) => void,
  ): Promise<VisualAnalysisResult> {
    if (this.active) throw new Error('A visual analysis is already running.');
    if (photos.length === 0) throw new Error('Visual analysis requires at least one photo.');
    this.active = true;
    this.cancellationRequested = false;
    this.storedEmbeddings.clear();
    let engine: ImageEmbeddingEngine | undefined;
    try {
      onProgress({ completed: 0, total: photos.length });
      engine = await this.createEngine();
      await engine.initialize();
      for (let index = 0; index < photos.length; index += 1) {
        this.throwIfCancelled();
        const photo = photos[index];
        if (!photo) throw new Error('Photo collection changed during analysis.');
        onProgress({ completed: index, total: photos.length, currentPhotoId: photo.id });
        const embedding = await engine.embed(photo);
        this.throwIfCancelled();
        this.storedEmbeddings.set(photo.id, embedding);
        onProgress({ completed: index + 1, total: photos.length });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      const processedPhotoIds = Object.freeze(photos.map(({ id }) => id));
      return Object.freeze({ embeddings: new Map(this.storedEmbeddings), processedPhotoIds });
    } catch (error) {
      this.storedEmbeddings.clear();
      if (this.cancellationRequested && !(error instanceof VisualAnalysisError && error.code === 'cancelled')) {
        throw new VisualAnalysisError('cancelled', 'Visual analysis was cancelled.', { cause: error });
      }
      throw error;
    } finally {
      this.active = false;
      if (engine) await engine.dispose();
    }
  }

  private throwIfCancelled(): void {
    if (this.cancellationRequested) {
      throw new VisualAnalysisError('cancelled', 'Visual analysis was cancelled.');
    }
  }
}
