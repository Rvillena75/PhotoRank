import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_VERSION = '1.24.3';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = resolve(repositoryRoot, 'node_modules/onnxruntime-react-native');
const packagePath = resolve(packageRoot, 'package.json');
const gradlePath = resolve(packageRoot, 'android/build.gradle');

const replacements = [
  {
    original: `def REACT_NATIVE_VERSION = ['node', '--print', "JSON.parse(require('fs').readFileSync(require.resolve('react-native/package.json'), 'utf-8')).version"].execute(null, rootDir).text.trim()
def REACT_NATIVE_MINOR_VERSION = REACT_NATIVE_VERSION.split("\\\\.")[1].toInteger()`,
    patched: `def REACT_NATIVE_VERSION = ['node', '--print', "JSON.parse(require('fs').readFileSync(require.resolve('react-native/package.json'), 'utf-8')).version"].execute(null, rootDir).text.trim()
def versionParts = REACT_NATIVE_VERSION.split("\\\\.")
if (versionParts.length < 2) {
  throw new GradleException("Invalid React Native version format: \${REACT_NATIVE_VERSION}. Expected format: major.minor[.patch]")
}
def REACT_NATIVE_MAJOR_VERSION = versionParts[0].toInteger()
def REACT_NATIVE_MINOR_VERSION = versionParts[1].toInteger()`,
  },
  {
    original: 'if (REACT_NATIVE_MINOR_VERSION >= 71) {',
    patched: 'if (REACT_NATIVE_MAJOR_VERSION > 0 || REACT_NATIVE_MINOR_VERSION >= 71) {',
  },
  {
    original: 'if (VersionNumber.parse(REACT_NATIVE_VERSION) < VersionNumber.parse("0.71")) {',
    patched: 'if (REACT_NATIVE_MAJOR_VERSION == 0 && REACT_NATIVE_MINOR_VERSION < 71) {',
  },
];

const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
if (packageJson.version !== EXPECTED_VERSION) {
  throw new Error(
    `Expected onnxruntime-react-native ${EXPECTED_VERSION}, found ${packageJson.version}. ` +
      'Review whether the Gradle 9 compatibility patch is still required.',
  );
}

let gradleSource = await readFile(gradlePath, 'utf8');
let changed = false;

for (const { original, patched } of replacements) {
  if (gradleSource.includes(patched)) continue;
  if (!gradleSource.includes(original)) {
    throw new Error(
      `onnxruntime-react-native ${EXPECTED_VERSION} does not contain the expected Gradle source. ` +
        'Refusing to apply a partial compatibility patch.',
    );
  }
  gradleSource = gradleSource.replace(original, patched);
  changed = true;
}

if (gradleSource.includes('VersionNumber.parse(')) {
  throw new Error('The ONNX Runtime Gradle 9 compatibility patch is incomplete.');
}

if (changed) {
  await writeFile(gradlePath, gradleSource, 'utf8');
  console.log('Patched onnxruntime-react-native 1.24.3 for Gradle 9 compatibility.');
} else {
  console.log('onnxruntime-react-native Gradle 9 compatibility patch is already applied.');
}
