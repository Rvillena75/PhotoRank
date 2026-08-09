import { canStartRanking, validateSelectedPhotos } from '..';
import type { PhotoAsset } from '../../../domain/contracts';

const photos: readonly PhotoAsset[] = [
  { id: 'a', assetId: 'library-a', uri: 'file://a.jpg' },
  { id: 'b', uri: 'file://b.jpg' },
];

describe('photo setup validation', () => {
  it('requires two photos and a valid K', () => {
    expect(canStartRanking([photos[0]!], 1)).toBe(false);
    expect(canStartRanking(photos, 0)).toBe(false);
    expect(canStartRanking(photos, 2)).toBe(true);
  });

  it('detects duplicates from an asset id or URI and tracks failed loads', () => {
    const duplicate: PhotoAsset = { id: 'c', assetId: 'library-a', uri: 'file://other.jpg' };
    const validation = validateSelectedPhotos([...photos, duplicate], ['b']);

    expect(validation.duplicatePhotoIds).toEqual(expect.arrayContaining(['a', 'c']));
    expect(validation.invalidPhotoIds).toContain('b');
    expect(canStartRanking([...photos, duplicate], 2, ['b'])).toBe(false);
  });
});
