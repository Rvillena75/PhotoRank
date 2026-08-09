import { Asset } from 'expo-asset';
import * as ort from 'onnxruntime-web/wasm';
import wasmAssetModule from '../../../../assets/runtime/ort-wasm-simd.wasm';

import type { ImageEmbeddingEngine, PhotoAsset } from '../../../domain/contracts';
import { VisualAnalysisError } from '../errors';
import { assertModelIntegrity } from '../integrity';
import { MODEL_ASSET_MODULE } from '../model-assets';
import { MODEL_MANIFEST } from '../model-manifest';
import { assertRuntimeNames, validateEmbedding } from '../runtime-contract';
import { preprocessWebPhoto } from './web-image-preprocessor';

async function assetBytes(moduleId: number): Promise<Uint8Array> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const response = await fetch(asset.localUri ?? asset.uri);
  if (!response.ok) throw new Error(`Asset request failed with status ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

export class WebImageEmbeddingEngine implements ImageEmbeddingEngine {
  private session: ort.InferenceSession | undefined;

  async initialize(): Promise<void> {
    if (this.session) return;
    try {
      const modelBytes = await assetBytes(MODEL_ASSET_MODULE);
      assertModelIntegrity(modelBytes);
      const wasmAsset = Asset.fromModule(wasmAssetModule);
      await wasmAsset.downloadAsync();
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = { 'ort-wasm-simd.wasm': wasmAsset.localUri ?? wasmAsset.uri };
      const session = await ort.InferenceSession.create(modelBytes, {
        executionProviders: ['wasm'],
        executionMode: 'sequential',
        graphOptimizationLevel: 'all',
      });
      assertRuntimeNames(session);
      this.session = session;
    } catch (error) {
      await this.dispose();
      if (error instanceof VisualAnalysisError) throw error;
      throw new VisualAnalysisError('model-load', 'ONNX Runtime Web could not initialize.', { cause: error });
    }
  }

  async embed(photo: PhotoAsset): Promise<readonly number[]> {
    const session = this.session;
    if (!session) throw new VisualAnalysisError('model-load', 'ImageEmbeddingEngine is not initialized.');
    const inputValues = await preprocessWebPhoto(photo);
    const inputTensor = new ort.Tensor('float32', inputValues, [...MODEL_MANIFEST.graph.inputShape]);
    let outputTensor: ort.Tensor | undefined;
    try {
      const result = await session.run({ [MODEL_MANIFEST.graph.inputName]: inputTensor });
      const output = result[MODEL_MANIFEST.graph.outputName];
      if (!(output instanceof ort.Tensor) || output.type !== 'float32' || !(output.data instanceof Float32Array)) {
        throw new VisualAnalysisError('invalid-output', 'ONNX Runtime Web returned a non-float tensor.');
      }
      outputTensor = output;
      return validateEmbedding(output.data, output.dims);
    } catch (error) {
      if (error instanceof VisualAnalysisError) throw error;
      throw new VisualAnalysisError('inference', 'ONNX Runtime Web inference failed.', { cause: error });
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
