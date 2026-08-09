import type { PhotoId } from '../contracts';
import type { RatingEngine } from './rating-engine';
import type { ComparisonOutcome, ComparisonRecord, PhotoRating, RankingSession } from './types';

function freezeRating(rating: PhotoRating): PhotoRating {
  return Object.freeze({ ...rating });
}

function freezeRecord(record: ComparisonRecord): ComparisonRecord {
  return Object.freeze({
    ...record,
    outcome: Object.freeze({ ...record.outcome }) as ComparisonOutcome,
  });
}

function freezeRatings(entries: Iterable<readonly [PhotoId, PhotoRating]>): Readonly<Record<PhotoId, PhotoRating>> {
  return Object.freeze(Object.fromEntries(Array.from(entries, ([id, rating]) => [id, freezeRating(rating)])));
}

function validatePhotoIds(photoIds: readonly PhotoId[]): void {
  if (photoIds.length === 0) {
    throw new Error('A ranking session requires at least one photo.');
  }

  if (new Set(photoIds).size !== photoIds.length) {
    throw new Error('Photo ids must be unique.');
  }

  if (photoIds.some((photoId) => photoId.length === 0)) {
    throw new Error('Photo ids cannot be empty.');
  }
}

function validateRecord(session: RankingSession, record: ComparisonRecord): void {
  if (record.id.length === 0) {
    throw new Error('Comparison ids cannot be empty.');
  }
  if (session.history.some(({ id }) => id === record.id)) {
    throw new Error(`Comparison id already exists: ${record.id}`);
  }
  if (!(record.leftPhotoId in session.ratings) || !(record.rightPhotoId in session.ratings)) {
    throw new Error('Both comparison photos must belong to the session.');
  }
  if (record.leftPhotoId === record.rightPhotoId) {
    throw new Error('A photo cannot be compared with itself.');
  }
  if (!Number.isFinite(record.createdAt)) {
    throw new Error('Comparison createdAt must be finite.');
  }
}

function ratingFor(session: RankingSession, photoId: PhotoId): PhotoRating {
  const rating = session.ratings[photoId];
  if (!rating) {
    throw new Error(`Missing rating for photo: ${photoId}`);
  }
  return rating;
}

export function createRankingSession(photoIds: readonly PhotoId[], engine: RatingEngine): RankingSession {
  validatePhotoIds(photoIds);
  const immutablePhotoIds = Object.freeze([...photoIds]);
  const ratings = freezeRatings(immutablePhotoIds.map((photoId) => [photoId, engine.createInitialRating()] as const));

  return Object.freeze({
    photoIds: immutablePhotoIds,
    ratings,
    history: Object.freeze([]),
  });
}

export function applyComparison(
  session: RankingSession,
  record: ComparisonRecord,
  engine: RatingEngine,
): RankingSession {
  validateRecord(session, record);
  const immutableRecord = freezeRecord(record);
  const currentLeft = ratingFor(session, record.leftPhotoId);
  const currentRight = ratingFor(session, record.rightPhotoId);
  const updated = engine.rate(currentLeft, currentRight, immutableRecord.outcome);

  const ratings = record.outcome.type === 'skip'
    ? session.ratings
    : freezeRatings(session.photoIds.map((photoId) => {
        if (photoId === record.leftPhotoId) return [photoId, updated.left] as const;
        if (photoId === record.rightPhotoId) return [photoId, updated.right] as const;
        return [photoId, ratingFor(session, photoId)] as const;
      }));

  return Object.freeze({
    photoIds: session.photoIds,
    ratings,
    history: Object.freeze([...session.history, immutableRecord]),
  });
}

export function rebuildRankingSession(
  photoIds: readonly PhotoId[],
  history: readonly ComparisonRecord[],
  engine: RatingEngine,
): RankingSession {
  return history.reduce(
    (session, record) => applyComparison(session, record, engine),
    createRankingSession(photoIds, engine),
  );
}

export function undoLastComparison(session: RankingSession, engine: RatingEngine): RankingSession {
  if (session.history.length === 0) return session;
  return rebuildRankingSession(session.photoIds, session.history.slice(0, -1), engine);
}
