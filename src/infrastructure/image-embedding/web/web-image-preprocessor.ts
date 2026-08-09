import type { PhotoAsset } from '../../../domain/contracts';
import { VisualAnalysisError } from '../errors';
import { centerCropOrigin, pixelsToNormalizedNchw, resizedDimensions } from '../preprocessing';

function canvas(width: number, height: number): HTMLCanvasElement {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return element;
}

export async function preprocessWebPhoto(photo: PhotoAsset): Promise<Float32Array> {
  let bitmap: ImageBitmap | undefined;
  try {
    const response = await fetch(photo.uri);
    if (!response.ok) throw new Error(`Image request failed with status ${response.status}.`);
    const blob = await response.blob();
    bitmap = await createImageBitmap(blob, {
      colorSpaceConversion: 'default',
      imageOrientation: 'from-image',
      premultiplyAlpha: 'none',
    });
    const resized = resizedDimensions(bitmap.width, bitmap.height);
    const resizedCanvas = canvas(resized.width, resized.height);
    const resizedContext = resizedCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
    if (!resizedContext) throw new Error('Canvas 2D is unavailable.');
    resizedContext.imageSmoothingEnabled = true;
    resizedContext.imageSmoothingQuality = 'high';
    resizedContext.drawImage(bitmap, 0, 0, resized.width, resized.height);

    const origin = centerCropOrigin(resized.width, resized.height);
    const croppedCanvas = canvas(224, 224);
    const croppedContext = croppedCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!croppedContext) throw new Error('Canvas 2D is unavailable.');
    croppedContext.drawImage(resizedCanvas, origin.x, origin.y, 224, 224, 0, 0, 224, 224);
    const pixels = croppedContext.getImageData(0, 0, 224, 224);
    return pixelsToNormalizedNchw({ width: 224, height: 224, channels: 4, data: pixels.data });
  } catch (error) {
    if (error instanceof VisualAnalysisError) throw error;
    throw new VisualAnalysisError('preprocessing', 'Web image preprocessing failed.', { cause: error });
  } finally {
    bitmap?.close();
  }
}
