import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { decode } from 'fast-png';
import { Image } from 'react-native';

import type { PhotoAsset } from '../../../domain/contracts';
import { VisualAnalysisError } from '../errors';
import { centerCropOrigin, pixelsToNormalizedNchw, resizedDimensions } from '../preprocessing';

function imageSize(uri: string): Promise<Readonly<{ width: number; height: number }>> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

function pngChannels(channels: number): 1 | 2 | 3 | 4 {
  if (channels === 1 || channels === 2 || channels === 3 || channels === 4) return channels;
  throw new VisualAnalysisError('preprocessing', `Unsupported PNG channel count: ${channels}.`);
}

export async function preprocessNativePhoto(photo: PhotoAsset): Promise<Float32Array> {
  let temporaryFile: File | undefined;
  try {
    const sourceSize = await imageSize(photo.uri);
    const resized = resizedDimensions(sourceSize.width, sourceSize.height);
    const origin = centerCropOrigin(resized.width, resized.height);
    const result = await manipulateAsync(
      photo.uri,
      [
        { resize: { width: resized.width, height: resized.height } },
        { crop: { originX: origin.x, originY: origin.y, width: 224, height: 224 } },
      ],
      { base64: false, compress: 1, format: SaveFormat.PNG },
    );
    temporaryFile = new File(result.uri);
    const encoded = await temporaryFile.bytes();
    const decoded = decode(encoded, { checkCrc: true });
    if (decoded.depth !== 8 || !(decoded.data instanceof Uint8Array)) {
      throw new VisualAnalysisError('preprocessing', 'Native preprocessor expected an 8-bit PNG.');
    }
    return pixelsToNormalizedNchw({
      width: decoded.width,
      height: decoded.height,
      channels: pngChannels(decoded.channels),
      data: decoded.data,
    });
  } catch (error) {
    if (error instanceof VisualAnalysisError) throw error;
    throw new VisualAnalysisError('preprocessing', 'Native image preprocessing failed.', { cause: error });
  } finally {
    if (temporaryFile) {
      try { temporaryFile.delete(); } catch { /* Temporary cleanup is best effort after processing failure. */ }
    }
  }
}
