import type { PhotoId } from '../../domain/contracts';
import { DEFAULT_RANKING_CONFIG } from '../../domain/ranking-config';
import type { RatingParameters } from '../../domain/ranking-config';
import type {
  ComparisonOutcome,
  ComparisonRecord,
  PhotoRating,
  RatedPair,
  RatingEngine,
} from '../../domain/rating';

export interface BradleyTerryParameters {
  readonly maximumIterations: number;
  readonly convergenceTolerance: number;
  readonly drawWeight: number;
}

export const DEFAULT_BRADLEY_TERRY_PARAMETERS: BradleyTerryParameters = Object.freeze({
  maximumIterations: 30,
  convergenceTolerance: 1e-8,
  drawWeight: 1,
});

interface Observation {
  readonly leftIndex: number;
  readonly rightIndex: number;
  readonly target: number;
  readonly weight: number;
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const exponent = Math.exp(-value);
    return 1 / (1 + exponent);
  }
  const exponent = Math.exp(value);
  return exponent / (1 + exponent);
}

function assertFiniteRating(rating: PhotoRating): void {
  if (![rating.mu, rating.sigma, rating.matches, rating.wins, rating.losses, rating.draws].every(Number.isFinite)
    || rating.sigma <= 0) {
    throw new Error('Bradley-Terry engine produced an invalid rating.');
  }
}

function validateParameters(parameters: BradleyTerryParameters): void {
  if (!Number.isInteger(parameters.maximumIterations) || parameters.maximumIterations < 1) {
    throw new RangeError('Bradley-Terry maximumIterations must be a positive integer.');
  }
  if (!(parameters.convergenceTolerance > 0) || !(parameters.drawWeight > 0)) {
    throw new RangeError('Bradley-Terry tolerance and drawWeight must be positive.');
  }
}

function zeroMatrix(size: number): number[][] {
  return Array.from({ length: size }, () => Array<number>(size).fill(0));
}

function cholesky(matrix: readonly (readonly number[])[]): number[][] {
  const size = matrix.length;
  const lower = zeroMatrix(size);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let value = matrix[row]?.[column] ?? 0;
      for (let previous = 0; previous < column; previous += 1) {
        value -= (lower[row]?.[previous] ?? 0) * (lower[column]?.[previous] ?? 0);
      }
      if (row === column) {
        if (!(value > 0)) throw new Error('Bradley-Terry Hessian is not positive definite.');
        lower[row]![column] = Math.sqrt(value);
      } else {
        lower[row]![column] = value / (lower[column]?.[column] ?? 1);
      }
    }
  }
  return lower;
}

function solveWithCholesky(lower: readonly (readonly number[])[], rightHandSide: readonly number[]): number[] {
  const size = lower.length;
  const intermediate = Array<number>(size).fill(0);
  for (let row = 0; row < size; row += 1) {
    let value = rightHandSide[row] ?? 0;
    for (let column = 0; column < row; column += 1) {
      value -= (lower[row]?.[column] ?? 0) * (intermediate[column] ?? 0);
    }
    intermediate[row] = value / (lower[row]?.[row] ?? 1);
  }
  const solution = Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let value = intermediate[row] ?? 0;
    for (let column = row + 1; column < size; column += 1) {
      value -= (lower[column]?.[row] ?? 0) * (solution[column] ?? 0);
    }
    solution[row] = value / (lower[row]?.[row] ?? 1);
  }
  return solution;
}

function posteriorDiagonal(lower: readonly (readonly number[])[]): number[] {
  return Array.from({ length: lower.length }, (_, index) => {
    const basis = Array<number>(lower.length).fill(0);
    basis[index] = 1;
    return solveWithCholesky(lower, basis)[index] ?? 0;
  });
}

function observationsFromHistory(
  photoIndex: ReadonlyMap<PhotoId, number>,
  history: readonly ComparisonRecord[],
  drawWeight: number,
): readonly Observation[] {
  return history.flatMap((record): readonly Observation[] => {
    if (record.outcome.type === 'skip') return [];
    const leftIndex = photoIndex.get(record.leftPhotoId);
    const rightIndex = photoIndex.get(record.rightPhotoId);
    if (leftIndex === undefined || rightIndex === undefined) {
      throw new Error('Bradley-Terry history contains a photo outside the session.');
    }
    return [Object.freeze({
      leftIndex,
      rightIndex,
      target: record.outcome.type === 'left' ? 1 : record.outcome.type === 'right' ? 0 : 0.5,
      weight: record.outcome.type === 'draw' ? drawWeight : 1,
    })];
  });
}

function buildSystem(
  utilities: readonly number[],
  observations: readonly Observation[],
  priorPrecision: number,
): Readonly<{ gradient: readonly number[]; hessian: readonly (readonly number[])[] }> {
  const gradient = utilities.map((utility) => priorPrecision * utility);
  const hessian = zeroMatrix(utilities.length);
  for (let index = 0; index < utilities.length; index += 1) hessian[index]![index] = priorPrecision;
  for (const observation of observations) {
    const difference = (utilities[observation.leftIndex] ?? 0) - (utilities[observation.rightIndex] ?? 0);
    const probability = sigmoid(difference);
    const residual = observation.weight * (probability - observation.target);
    const curvature = observation.weight * Math.max(1e-9, probability * (1 - probability));
    gradient[observation.leftIndex] = (gradient[observation.leftIndex] ?? 0) + residual;
    gradient[observation.rightIndex] = (gradient[observation.rightIndex] ?? 0) - residual;
    hessian[observation.leftIndex]![observation.leftIndex] = (hessian[observation.leftIndex]?.[observation.leftIndex] ?? 0) + curvature;
    hessian[observation.rightIndex]![observation.rightIndex] = (hessian[observation.rightIndex]?.[observation.rightIndex] ?? 0) + curvature;
    hessian[observation.leftIndex]![observation.rightIndex] = (hessian[observation.leftIndex]?.[observation.rightIndex] ?? 0) - curvature;
    hessian[observation.rightIndex]![observation.leftIndex] = (hessian[observation.rightIndex]?.[observation.leftIndex] ?? 0) - curvature;
  }
  return Object.freeze({ gradient: Object.freeze(gradient), hessian: Object.freeze(hessian) });
}

function statisticsFor(photoId: PhotoId, history: readonly ComparisonRecord[]): Readonly<{
  matches: number;
  wins: number;
  losses: number;
  draws: number;
}> {
  let matches = 0;
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const record of history) {
    if (record.outcome.type === 'skip'
      || (record.leftPhotoId !== photoId && record.rightPhotoId !== photoId)) continue;
    matches += 1;
    if (record.outcome.type === 'draw') draws += 1;
    else if ((record.outcome.type === 'left' && record.leftPhotoId === photoId)
      || (record.outcome.type === 'right' && record.rightPhotoId === photoId)) wins += 1;
    else losses += 1;
  }
  return Object.freeze({ matches, wins, losses, draws });
}

export class BradleyTerryRatingEngine implements RatingEngine {
  readonly parameters: RatingParameters;
  private readonly bradleyTerry: BradleyTerryParameters;

  constructor(
    parameters: RatingParameters = DEFAULT_RANKING_CONFIG.rating,
    bradleyTerry: BradleyTerryParameters = DEFAULT_BRADLEY_TERRY_PARAMETERS,
  ) {
    validateParameters(bradleyTerry);
    this.parameters = Object.freeze({ ...parameters });
    this.bradleyTerry = Object.freeze({ ...bradleyTerry });
  }

  createInitialRating(): PhotoRating {
    return Object.freeze({
      mu: this.parameters.initialMu,
      sigma: this.parameters.initialSigma,
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    });
  }

  rate(left: PhotoRating, right: PhotoRating, outcome: ComparisonOutcome): RatedPair {
    if (outcome.type === 'skip') return Object.freeze({ left, right });
    const scale = this.parameters.beta;
    const leftUtility = (left.mu - this.parameters.initialMu) / scale;
    const rightUtility = (right.mu - this.parameters.initialMu) / scale;
    const target = outcome.type === 'left' ? 1 : outcome.type === 'right' ? 0 : 0.5;
    const probability = sigmoid(leftUtility - rightUtility);
    const step = (target - probability) / 2;
    const posteriorSigma = Math.max(
      Number.EPSILON,
      Math.sqrt(1 / (1 / ((left.sigma / scale) ** 2) + probability * (1 - probability))) * scale,
    );
    const leftResult = Object.freeze({
      mu: left.mu + scale * step,
      sigma: posteriorSigma,
      matches: left.matches + 1,
      wins: left.wins + (outcome.type === 'left' ? 1 : 0),
      losses: left.losses + (outcome.type === 'right' ? 1 : 0),
      draws: left.draws + (outcome.type === 'draw' ? 1 : 0),
    });
    const rightResult = Object.freeze({
      mu: right.mu - scale * step,
      sigma: posteriorSigma,
      matches: right.matches + 1,
      wins: right.wins + (outcome.type === 'right' ? 1 : 0),
      losses: right.losses + (outcome.type === 'left' ? 1 : 0),
      draws: right.draws + (outcome.type === 'draw' ? 1 : 0),
    });
    assertFiniteRating(leftResult);
    assertFiniteRating(rightResult);
    return Object.freeze({ left: leftResult, right: rightResult });
  }

  inferRatings(
    photoIds: readonly PhotoId[],
    history: readonly ComparisonRecord[],
  ): Readonly<Record<PhotoId, PhotoRating>> {
    const photoIndex = new Map(photoIds.map((photoId, index) => [photoId, index] as const));
    const observations = observationsFromHistory(photoIndex, history, this.bradleyTerry.drawWeight);
    const utilityScale = this.parameters.initialSigma / this.parameters.beta;
    const priorPrecision = 1 / (utilityScale * utilityScale);
    let utilities = Array<number>(photoIds.length).fill(0);
    let system = buildSystem(utilities, observations, priorPrecision);
    for (let iteration = 0; iteration < this.bradleyTerry.maximumIterations; iteration += 1) {
      const lower = cholesky(system.hessian);
      const delta = solveWithCholesky(lower, system.gradient);
      utilities = utilities.map((utility, index) => utility - (delta[index] ?? 0));
      if (Math.max(...delta.map(Math.abs)) <= this.bradleyTerry.convergenceTolerance) break;
      system = buildSystem(utilities, observations, priorPrecision);
    }
    system = buildSystem(utilities, observations, priorPrecision);
    const lower = cholesky(system.hessian);
    const variance = posteriorDiagonal(lower);
    const ratings = Object.fromEntries(photoIds.map((photoId, index) => {
      const stats = statisticsFor(photoId, history);
      const rating = Object.freeze({
        mu: this.parameters.initialMu + this.parameters.beta * (utilities[index] ?? 0),
        sigma: this.parameters.beta * Math.sqrt(Math.max(Number.EPSILON, variance[index] ?? 0)),
        ...stats,
      });
      assertFiniteRating(rating);
      return [photoId, rating] as const;
    }));
    return Object.freeze(ratings);
  }

  conservativeScore(rating: PhotoRating): number {
    assertFiniteRating(rating);
    return rating.mu - this.parameters.conservativeSigmaMultiplier * rating.sigma;
  }
}
