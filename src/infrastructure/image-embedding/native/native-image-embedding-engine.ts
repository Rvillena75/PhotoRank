import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { InferenceSession, Tensor } from 'onnxruntime-react-native';

import type { ImageEmbeddingEngine, PhotoAsset } from '../../../domain/contracts';
import { VisualAnalysisError } from '../errors';
import { assertModelIntegrity } from '../integrity';
import { MODEL_ASSET_MODULE } from '../model-assets';
import { MODEL_MANIFEST } from '../model-manifest';
import { assertRuntimeContract, validateEmbedding } from '../runtime-contract';
import { preprocessNativePhoto } from './native-image-preprocessor';

async function packagedModelBytes(): Promise<Uint8Array> {
  const asset = Asset.fromModule(MODEL_ASSET_MODULE);
  await asset.downloadAsync();
  const uri = asset.localUri;
  if (!uri) throw new Error('The packaged ONNX asset has no local URI.');
  return new File(uri).bytes();
}

export class NativeImageEmbeddingEngine implements ImageEmbeddingEngine {
  private session: InferenceSession | undefined;

  async initialize(): Promise<void> {
    if (this.session) return;
    try {
      const modelBytes = await packagedModelBytes();
      assertModelIntegrity(modelBytes);
      const session = await InferenceSession.create(modelBytes, {
        executionMode: 'sequential',
        graphOptimizationLevel: 'all',
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
      });
      assertRuntimeContract(session);
      this.session = session;
    } catch (error) {
      await this.dispose();
      if (error instanceof VisualAnalysisError) throw error;
      throw new VisualAnalysisError('model-load', 'ONNX Runtime React Native could not initialize.', { cause: error });
    }
  }

  async embed(photo: PhotoAsset): Promise<readonly number[]> {
    const session = this.session;
    if (!session) throw new VisualAnalysisError('model-load', 'ImageEmbeddingEngine is not initialized.');
    const inputValues = await preprocessNativePhoto(photo);
    const inputTensor = new Tensor('float32', inputValues, [...MODEL_MANIFEST.graph.inputShape]);
    let outputTensor: Tensor | undefined;
    try {
      const result = await session.run({ [MODEL_MANIFEST.graph.inputName]: inputTensor });
      const output = result[MODEL_MANIFEST.graph.outputName];
      if (!(output instanceof Tensor) || output.type !== 'float32' || !(output.data instanceof Float32Array)) {
        throw new VisualAnalysisError('invalid-output', 'ONNX Runtime React Native returned a non-float tensor.');
      }
      outputTensor = output;
      return validateEmbedding(output.data, output.dims);
    } catch (error) {
      if (error instanceof VisualAnalysisError) throw error;
      throw new VisualAnalysisError('inference', 'ONNX Runtime React Native inference failed.', { cause: error });
    } finally {
      outputTensor?.dispose();
      inputTensor.dispose();
    }
  }

  async dispose(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    if (session) await session.release();
  }
}
