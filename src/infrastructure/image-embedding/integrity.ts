import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { MODEL_MANIFEST } from './model-manifest';
import { VisualAnalysisError } from './errors';

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export function assertModelIntegrity(bytes: Uint8Array): void {
  const actualHash = sha256Hex(bytes);
  if (actualHash !== MODEL_MANIFEST.sha256) {
    throw new VisualAnalysisError(
      'integrity',
      `Packaged ONNX SHA-256 mismatch: expected ${MODEL_MANIFEST.sha256}, got ${actualHash}.`,
    );
  }
}
