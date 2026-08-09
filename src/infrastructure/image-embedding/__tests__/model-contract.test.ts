import rawManifest from '../../../../assets/models/MODEL_MANIFEST.json';
import { MODEL_MANIFEST, validateModelManifest } from '../model-manifest';
import { centerCropOrigin, pixelsToNormalizedNchw, resizedDimensions } from '../preprocessing';
import { assertRuntimeContract, assertRuntimeNames, validateEmbedding } from '../runtime-contract';

describe('frozen image embedding contract', () => {
  it('accepts the versioned manifest and rejects placeholders or model drift', () => {
    expect(validateModelManifest(rawManifest)).toBe(MODEL_MANIFEST);
    expect(MODEL_MANIFEST.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => validateModelManifest({ ...rawManifest, sha256: 'PLACEHOLDER' })).toThrow();
    expect(() => validateModelManifest({ ...rawManifest, graph: { ...rawManifest.graph, outputShape: [1, 1024] } })).toThrow();
  });

  it('computes TorchVision-compatible resize and center-crop geometry', () => {
    expect(resizedDimensions(320, 240)).toEqual({ width: 341, height: 256 });
    expect(resizedDimensions(240, 320)).toEqual({ width: 256, height: 341 });
    expect(centerCropOrigin(341, 256)).toEqual({ x: 58, y: 16 });
    expect(centerCropOrigin(256, 341)).toEqual({ x: 16, y: 58 });
  });

  it('produces planar NCHW float32 values with the frozen channel normalization', () => {
    const pixels = new Uint8Array(224 * 224 * 3);
    for (let index = 0; index < pixels.length; index += 3) {
      pixels[index] = 255;
      pixels[index + 1] = 128;
      pixels[index + 2] = 0;
    }
    const tensor = pixelsToNormalizedNchw({ width: 224, height: 224, channels: 3, data: pixels });
    expect(tensor).toHaveLength(1 * 3 * 224 * 224);
    expect(tensor[0]).toBeCloseTo((1 - 0.485) / 0.229, 6);
    expect(tensor[224 * 224]).toBeCloseTo((128 / 255 - 0.456) / 0.224, 6);
    expect(tensor[2 * 224 * 224]).toBeCloseTo((0 - 0.406) / 0.225, 6);
  });

  it('validates runtime names, types, static shapes and normalized output', () => {
    const session = {
      inputNames: ['image'],
      outputNames: ['embedding'],
      inputMetadata: [{ name: 'image', isTensor: true, type: 'float32', shape: [1, 3, 224, 224] }],
      outputMetadata: [{ name: 'embedding', isTensor: true, type: 'float32', shape: [1, 576] }],
    } as const;
    expect(() => assertRuntimeContract(session)).not.toThrow();
    expect(() => assertRuntimeNames(session)).not.toThrow();
    expect(() => assertRuntimeContract({ ...session, outputNames: ['logits'] })).toThrow();

    const normalized = new Float32Array(576);
    normalized[0] = 1;
    expect(validateEmbedding(normalized, [1, 576])).toHaveLength(576);
    normalized[0] = 2;
    expect(() => validateEmbedding(normalized, [1, 576])).toThrow('L2 norm');
  });
});
