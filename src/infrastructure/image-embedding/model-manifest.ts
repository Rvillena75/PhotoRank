import rawManifest from '../../../assets/models/MODEL_MANIFEST.json';

export interface ModelManifest {
  readonly schemaVersion: 1;
  readonly modelId: 'torchvision-mobilenet-v3-small-imagenet1k-v1-pooled-576';
  readonly modelVersion: '1.0.0';
  readonly file: 'mobilenet_v3_small_imagenet1k_v1_pooled_l2.onnx';
  readonly sha256: string;
  readonly source: Readonly<{
    framework: 'torchvision';
    architecture: 'mobilenet_v3_small';
    weights: 'MobileNet_V3_Small_Weights.IMAGENET1K_V1';
    checkpointUrl: 'https://download.pytorch.org/models/mobilenet_v3_small-047dcff4.pth';
    checkpointSha256: '047dcff4addef86ea5bc2eff13c9614dc11f47ab1160d0a71a25e7db994f4e1f';
    widthMult: 1;
    reducedTail: false;
    dilated: false;
  }>;
  readonly graph: Readonly<{
    opset: 17;
    inputName: 'image';
    inputDtype: 'float32';
    inputShape: readonly [1, 3, 224, 224];
    outputName: 'embedding';
    outputDtype: 'float32';
    outputShape: readonly [1, 576];
    extractionPoint: 'features.avgpool.flatten';
    l2Normalization: Readonly<{ p: 2; axis: 1; epsilon: 1e-12 }>;
    quantization: 'none';
  }>;
  readonly preprocessing: Readonly<{
    exifOrientation: 'normalize';
    colorSpace: 'sRGB';
    channels: 'RGB';
    resizeShortSide: 256;
    interpolation: 'bilinear';
    antialias: true;
    centerCrop: readonly [224, 224];
    valueRange: readonly [0, 1];
    mean: readonly [0.485, 0.456, 0.406];
    std: readonly [0.229, 0.224, 0.225];
  }>;
  readonly toolchain: Readonly<{
    python: string;
    torch: string;
    torchvision: string;
    onnx: string;
    onnxruntime: string;
    exporter: 'torch.onnx.export';
  }>;
  readonly license: Readonly<{
    code: string;
    weights: string;
    datasetTerms: string;
  }>;
}

const EXPECTED_CHECKPOINT_HASH = '047dcff4addef86ea5bc2eff13c9614dc11f47ab1160d0a71a25e7db994f4e1f';
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameArray(value: unknown, expected: readonly unknown[]): boolean {
  return Array.isArray(value) && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function nonEmptyStrings(record: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof record[key] === 'string' && (record[key] as string).trim().length > 0);
}

export function validateModelManifest(value: unknown): ModelManifest {
  if (!isRecord(value) || JSON.stringify(value).toLowerCase().includes('placeholder')) {
    throw new Error('MODEL_MANIFEST.json is missing or contains placeholders.');
  }
  const source = value.source;
  const graph = value.graph;
  const preprocessing = value.preprocessing;
  const toolchain = value.toolchain;
  const license = value.license;
  if (!isRecord(source) || !isRecord(graph) || !isRecord(preprocessing) || !isRecord(toolchain) || !isRecord(license)) {
    throw new Error('MODEL_MANIFEST.json has an invalid structure.');
  }
  const correctIdentity = value.schemaVersion === 1
    && value.modelId === 'torchvision-mobilenet-v3-small-imagenet1k-v1-pooled-576'
    && value.modelVersion === '1.0.0'
    && value.file === 'mobilenet_v3_small_imagenet1k_v1_pooled_l2.onnx'
    && typeof value.sha256 === 'string' && SHA256_PATTERN.test(value.sha256);
  const correctSource = source.framework === 'torchvision'
    && source.architecture === 'mobilenet_v3_small'
    && source.weights === 'MobileNet_V3_Small_Weights.IMAGENET1K_V1'
    && source.checkpointUrl === 'https://download.pytorch.org/models/mobilenet_v3_small-047dcff4.pth'
    && source.checkpointSha256 === EXPECTED_CHECKPOINT_HASH
    && source.widthMult === 1 && source.reducedTail === false && source.dilated === false;
  const normalization = graph.l2Normalization;
  const correctGraph = graph.opset === 17
    && graph.inputName === 'image' && graph.inputDtype === 'float32'
    && sameArray(graph.inputShape, [1, 3, 224, 224])
    && graph.outputName === 'embedding' && graph.outputDtype === 'float32'
    && sameArray(graph.outputShape, [1, 576])
    && graph.extractionPoint === 'features.avgpool.flatten'
    && graph.quantization === 'none'
    && isRecord(normalization) && normalization.p === 2 && normalization.axis === 1 && normalization.epsilon === 1e-12;
  const correctPreprocessing = preprocessing.exifOrientation === 'normalize'
    && preprocessing.colorSpace === 'sRGB' && preprocessing.channels === 'RGB'
    && preprocessing.resizeShortSide === 256 && preprocessing.interpolation === 'bilinear'
    && preprocessing.antialias === true && sameArray(preprocessing.centerCrop, [224, 224])
    && sameArray(preprocessing.valueRange, [0, 1])
    && sameArray(preprocessing.mean, [0.485, 0.456, 0.406])
    && sameArray(preprocessing.std, [0.229, 0.224, 0.225]);
  const correctToolchain = nonEmptyStrings(toolchain, ['python', 'torch', 'torchvision', 'onnx', 'onnxruntime'])
    && toolchain.exporter === 'torch.onnx.export';
  const correctLicense = nonEmptyStrings(license, ['code', 'weights', 'datasetTerms']);
  if (!correctIdentity || !correctSource || !correctGraph || !correctPreprocessing || !correctToolchain || !correctLicense) {
    throw new Error('MODEL_MANIFEST.json does not match the frozen PhotoRank model contract.');
  }
  return value as unknown as ModelManifest;
}

export const MODEL_MANIFEST = validateModelManifest(rawManifest);
