import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { PhotoAsset } from '../domain/contracts';
import { colors } from '../theme';

const fixturePalettes = ['#E78D65', '#5568A8', '#4E8B75', '#B57651', '#31798A', '#A25E78'];

function colorFor(photoId: string): string {
  const number = [...photoId].reduce((total, character) => total + character.charCodeAt(0), 0);
  return fixturePalettes[number % fixturePalettes.length] ?? colors.accent;
}

export function PhotoPreview({
  photo,
  onError,
  onLoad,
  label,
}: Readonly<{ photo: PhotoAsset; onError?: () => void; onLoad?: () => void; label?: string }>): ReactNode {
  const isFixture = photo.uri.startsWith('fixture://');
  if (isFixture) {
    return (
      <View accessibilityRole="image" accessibilityLabel={label ?? photo.filename ?? 'Foto de ejemplo'} style={[styles.fixture, { backgroundColor: colorFor(photo.id) }]}>
        <Text style={styles.fixtureText}>{(photo.filename ?? 'Foto').replace(/\.[^.]+$/, '').slice(0, 14)}</Text>
      </View>
    );
  }
  return <Image accessibilityLabel={label ?? photo.filename ?? 'Foto seleccionada'} onError={onError} onLoad={onLoad} resizeMode="contain" source={{ uri: photo.uri }} style={styles.image} />;
}

const styles = StyleSheet.create({
  image: { height: '100%', width: '100%' },
  fixture: { alignItems: 'center', height: '100%', justifyContent: 'center', padding: 12, width: '100%' },
  fixtureText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', textAlign: 'center', textTransform: 'capitalize' },
});
