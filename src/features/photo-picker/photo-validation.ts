import type { PhotoAsset } from '../../domain/contracts';

export interface PhotoValidationResult {
  readonly duplicatePhotoIds: readonly string[];
  readonly invalidPhotoIds: readonly string[];
  readonly messages: readonly string[];
}

function identityFor(photo: PhotoAsset): string {
  return photo.assetId?.trim() || photo.uri.trim();
}

export function validateSelectedPhotos(
  photos: readonly PhotoAsset[],
  failedPhotoIds: readonly string[] = [],
): PhotoValidationResult {
  const identities = new Map<string, string>();
  const duplicates = new Set<string>();
  const invalid = new Set(failedPhotoIds);

  for (const photo of photos) {
    if (photo.id.trim().length === 0 || photo.uri.trim().length === 0) {
      invalid.add(photo.id);
      continue;
    }
    const identity = identityFor(photo);
    const existing = identities.get(identity);
    if (existing) {
      duplicates.add(existing);
      duplicates.add(photo.id);
    } else {
      identities.set(identity, photo.id);
    }
  }

  const messages: string[] = [];
  if (photos.length < 2) messages.push('Elige al menos 2 fotos para comparar.');
  if (duplicates.size > 0) messages.push('Hay fotos duplicadas. Quita una copia antes de empezar.');
  if (invalid.size > 0) messages.push('Hay una foto que no se pudo cargar. Puedes quitarla o reintentar.');
  return Object.freeze({
    duplicatePhotoIds: Object.freeze([...duplicates]),
    invalidPhotoIds: Object.freeze([...invalid]),
    messages: Object.freeze(messages),
  });
}

export function canStartRanking(
  photos: readonly PhotoAsset[],
  k: number,
  failedPhotoIds: readonly string[] = [],
): boolean {
  const validation = validateSelectedPhotos(photos, failedPhotoIds);
  return validation.messages.length === 0 && Number.isInteger(k) && k >= 1 && k <= photos.length;
}
