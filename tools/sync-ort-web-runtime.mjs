import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_VERSION = '1.18.0';
const EXPECTED_SHA256 = 'f533b5f21790563d7556c611c3835ac65848ee326da2689aac54ed7d9cc8c6a4';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = resolve(repositoryRoot, 'node_modules/onnxruntime-web/package.json');
const sourcePath = resolve(repositoryRoot, 'node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm');
const destinationDirectory = resolve(repositoryRoot, 'assets/runtime');
const destinationPath = resolve(destinationDirectory, 'ort-wasm-simd.wasm');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
if (packageJson.version !== EXPECTED_VERSION) {
  throw new Error(`Expected onnxruntime-web ${EXPECTED_VERSION}, found ${packageJson.version}.`);
}
const source = await readFile(sourcePath);
const actualHash = sha256(source);
if (actualHash !== EXPECTED_SHA256) {
  throw new Error(`onnxruntime-web WASM SHA-256 mismatch: expected ${EXPECTED_SHA256}, got ${actualHash}.`);
}
await mkdir(destinationDirectory, { recursive: true });
await copyFile(sourcePath, destinationPath);
const copiedHash = sha256(await readFile(destinationPath));
if (copiedHash !== EXPECTED_SHA256) throw new Error('Copied ONNX Runtime Web WASM failed integrity verification.');
