import { MODEL_MANIFEST } from './model-manifest';
import { VisualAnalysisError } from './errors';

export interface DecodedPixels {
  readonly width: number;
  readonly height: number;
  readonly channels: 1 | 2 | 3 | 4;
  readonly data: Uint8Array | Uint8ClampedArray;
}

const PIXEL_COUNT = 224 * 224;

export function pixelsToNormalizedNchw(pixels: DecodedPixels): Float32Array {
  if (pixels.width !== 224 || pixels.height !== 224 || pixels.data.length !== PIXEL_COUNT * pixels.channels) {
    throw new VisualAnalysisError('preprocessing', 'Preprocessed image does not have the expected 224 x 224 shape.');
  }
  const output = new Float32Array(3 * PIXEL_COUNT);
  const mean = MODEL_MANIFEST.preprocessing.mean;
  const std = MODEL_MANIFEST.preprocessing.std;
  for (let pixelIndex = 0; pixelIndex < PIXEL_COUNT; pixelIndex += 1) {
    const sourceIndex = pixelIndex * pixels.channels;
    const red = pixels.data[sourceIndex];
    const green = pixels.channels < 3 ? red : pixels.data[sourceIndex + 1];
    const blue = pixels.channels < 3 ? red : pixels.data[sourceIndex + 2];
    if (red === undefined || green === undefined || blue === undefined) {
      throw new VisualAnalysisError('preprocessing', 'Decoded pixels ended unexpectedly.');
    }
    output[pixelIndex] = (red / 255 - mean[0]) / std[0];
    output[PIXEL_COUNT + pixelIndex] = (green / 255 - mean[1]) / std[1];
    output[2 * PIXEL_COUNT + pixelIndex] = (blue / 255 - mean[2]) / std[2];
  }
  return output;
}

export function resizedDimensions(width: number, height: number): Readonly<{ width: number; height: number }> {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new VisualAnalysisError('preprocessing', 'Image dimensions are invalid.');
  }
  const shortSide = MODEL_MANIFEST.preprocessing.resizeShortSide;
  if (width <= height) return { width: shortSide, height: Math.floor((height * shortSide) / width) };
  return { width: Math.floor((width * shortSide) / height), height: shortSide };
}

function roundHalfToEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction < 0.5) return floor;
  if (fraction > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function centerCropOrigin(width: number, height: number): Readonly<{ x: number; y: number }> {
  const cropSize = MODEL_MANIFEST.preprocessing.centerCrop[0];
  if (width < cropSize || height < cropSize) {
    throw new VisualAnalysisError('preprocessing', 'Resized image is smaller than the center crop.');
  }
  return {
    x: roundHalfToEven((width - cropSize) / 2),
    y: roundHalfToEven((height - cropSize) / 2),
  };
}
