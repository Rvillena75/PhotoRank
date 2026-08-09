import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

import type { PhotoAsset } from '../../domain/contracts';

function selectionSummary(photos: readonly PhotoAsset[]): string {
  return `Mi Top ${photos.length} de PhotoRank:\n${photos.map((photo, index) => `${index + 1}. ${photo.filename ?? photo.id}`).join('\n')}`;
}

/** Exports only the local selection metadata; original image bytes are never copied or persisted. */
export async function shareSelection(photos: readonly PhotoAsset[]): Promise<void> {
  const summary = selectionSummary(photos);
  const directory = FileSystem.documentDirectory;
  const canShareFile = directory !== null && await Sharing.isAvailableAsync();
  if (canShareFile) {
    const fileUri = `${directory}photorank-top-${photos.length}.txt`;
    await FileSystem.writeAsStringAsync(fileUri, summary);
    await Sharing.shareAsync(fileUri, { mimeType: 'text/plain', dialogTitle: 'Compartir mi Top K' });
    return;
  }
  await Share.share({ message: summary, title: 'Mi Top K de PhotoRank' });
}

/** Shares an original local photo directly when the platform exposes a share sheet. */
export async function sharePhoto(photo: PhotoAsset): Promise<void> {
  if (photo.uri.startsWith('fixture://')) {
    throw new Error('Development fixtures do not have an image file to share.');
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(photo.uri, { dialogTitle: `Compartir ${photo.filename ?? 'foto'}` });
    return;
  }
  await Share.share({ message: photo.filename ?? 'Una foto de mi Top K', title: 'PhotoRank' });
}
