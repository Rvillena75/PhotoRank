import { MODEL_MANIFEST } from './model-manifest';
import { VisualAnalysisError } from './errors';

export interface RuntimeValueMetadata {
  readonly name: string;
  readonly isTensor: boolean;
  readonly type?: string;
  readonly shape?: readonly (number | string)[];
}

export interface RuntimeSessionContract {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  readonly inputMetadata: readonly RuntimeValueMetadata[];
  readonly outputMetadata: readonly RuntimeValueMetadata[];
}

function sameShape(actual: readonly (number | string)[] | undefined, expected: readonly number[]): boolean {
  return actual !== undefined && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

export function assertRuntimeContract(session: RuntimeSessionContract): void {
  const input = session.inputMetadata[0];
  const output = session.outputMetadata[0];
  const validInput = session.inputNames.length === 1 && session.inputNames[0] === MODEL_MANIFEST.graph.inputName
    && input?.name === MODEL_MANIFEST.graph.inputName && input.isTensor && input.type === MODEL_MANIFEST.graph.inputDtype
    && sameShape(input.shape, MODEL_MANIFEST.graph.inputShape);
  const validOutput = session.outputNames.length === 1 && session.outputNames[0] === MODEL_MANIFEST.graph.outputName
    && output?.name === MODEL_MANIFEST.graph.outputName && output.isTensor && output.type === MODEL_MANIFEST.graph.outputDtype
    && sameShape(output.shape, MODEL_MANIFEST.graph.outputShape);
  if (!validInput || !validOutput) {
    throw new VisualAnalysisError('integrity', 'ONNX Runtime metadata does not match MODEL_MANIFEST.json.');
  }
}

export function assertRuntimeNames(session: Readonly<{ inputNames: readonly string[]; outputNames: readonly string[] }>): void {
  const validInput = session.inputNames.length === 1 && session.inputNames[0] === MODEL_MANIFEST.graph.inputName;
  const validOutput = session.outputNames.length === 1 && session.outputNames[0] === MODEL_MANIFEST.graph.outputName;
  if (!validInput || !validOutput) {
    throw new VisualAnalysisError('integrity', 'ONNX Runtime names do not match MODEL_MANIFEST.json.');
  }
}

export function validateEmbedding(values: ArrayLike<number>, shape: readonly number[]): readonly number[] {
  if (shape.length !== 2 || shape[0] !== 1 || shape[1] !== 576 || values.length !== 576) {
    throw new VisualAnalysisError('invalid-output', 'Embedding shape is not [1, 576].');
  }
  let squaredNorm = 0;
  const embedding = new Array<number>(576);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined || !Number.isFinite(value)) {
      throw new VisualAnalysisError('invalid-output', 'Embedding contains a non-finite value.');
    }
    embedding[index] = value;
    squaredNorm += value * value;
  }
  const norm = Math.sqrt(squaredNorm);
  if (Math.abs(norm - 1) > 1e-5) {
    throw new VisualAnalysisError('invalid-output', `Embedding L2 norm is ${norm}.`);
  }
  return Object.freeze(embedding);
}
