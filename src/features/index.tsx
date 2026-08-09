import * as ImagePicker from 'expo-image-picker';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PhotoPreview } from '../components/photo-preview';
import type { PhotoAsset } from '../domain/contracts';
import type { SelectedPair } from '../domain/pair-selection';
import type { StopRecommendation, TopKConfidenceResult } from '../domain/confidence';
import { colors, spacing } from '../theme';
import { DEVELOPMENT_PHOTO_FIXTURES, canStartRanking, validateSelectedPhotos } from './photo-picker';
import { sharePhoto, shareSelection } from './ranking/export-selection';

export type FlowScreen = 'home' | 'setup' | 'comparison' | 'paused' | 'top-k-result' | 'visual-analysis';

export type VisualAnalysisScreenStatus = 'idle' | 'running' | 'cancelling' | 'complete' | 'error';

type ButtonProps = Readonly<{ label: string; onPress: () => void; disabled?: boolean; kind?: 'primary' | 'secondary' | 'danger' }>;

export function PrimaryButton({ label, onPress, disabled = false, kind = 'primary' }: ButtonProps): ReactNode {
  const style = kind === 'primary' ? styles.primaryButton : kind === 'danger' ? styles.dangerButton : styles.secondaryButton;
  const textStyle = kind === 'primary' || kind === 'danger' ? styles.primaryLabel : styles.secondaryLabel;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[style, disabled && styles.disabledButton]}>
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

function ScreenLayout({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">{children}</ScrollView>;
}

function filename(photo: PhotoAsset): string {
  return photo.filename ?? 'Foto sin nombre';
}

function PhotoViewer({ photo, onClose }: Readonly<{ photo: PhotoAsset | undefined; onClose: () => void }>): ReactNode {
  if (!photo) return null;
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <View style={styles.viewerBackdrop}>
        <View accessibilityViewIsModal style={styles.viewerCard}>
          <View style={styles.viewerImage}><PhotoPreview photo={photo} label={`Vista ampliada de ${filename(photo)}`} /></View>
          <Text style={styles.viewerFilename}>{filename(photo)}</Text>
          <PrimaryButton kind="secondary" label="Cerrar foto ampliada" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: Readonly<{ title: string; message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }>): ReactNode {
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible>
      <View style={styles.viewerBackdrop}>
        <View accessibilityViewIsModal style={styles.confirmCard}>
          <Text accessibilityRole="header" style={styles.confirmTitle}>{title}</Text>
          <Text style={styles.body}>{message}</Text>
          <PrimaryButton kind="danger" label={confirmLabel} onPress={onConfirm} />
          <PrimaryButton kind="secondary" label="Cancelar" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}

export function HomeScreen({ onStart }: Readonly<{ onStart: () => void }>): ReactNode {
  return (
    <ScreenLayout>
      <Text accessibilityRole="header" style={styles.eyebrow}>PhotoRank</Text>
      <Text style={styles.hero}>Elegir mis mejores fotos</Text>
      <Text style={styles.body}>Compara fotos de a dos, encuentra tus favoritas y crea un carrusel variado.</Text>
      <PrimaryButton label="Comenzar" onPress={onStart} />
      <Text style={styles.note}>Tus fotos y preferencias se quedan en este dispositivo.</Text>
    </ScreenLayout>
  );
}

function assetFromPicker(asset: ImagePicker.ImagePickerAsset, position: number): PhotoAsset {
  const assetId = asset.assetId ?? undefined;
  return Object.freeze({
    id: assetId ?? asset.uri,
    assetId,
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    filename: asset.fileName ?? `Foto ${position + 1}`,
  });
}

export function SetupScreen({
  photos,
  k,
  failedPhotoIds,
  onPhotosChange,
  onPhotoLoadError,
  onPhotoLoaded,
  onRetryPhoto,
  onKChange,
  onStart,
  onBack,
}: Readonly<{
  photos: readonly PhotoAsset[];
  k: number;
  failedPhotoIds: readonly string[];
  onPhotosChange: (photos: readonly PhotoAsset[]) => void;
  onPhotoLoadError: (photoId: string) => void;
  onPhotoLoaded: (photoId: string) => void;
  onRetryPhoto: (photoId: string) => void;
  onKChange: (k: number) => void;
  onStart: () => void;
  onBack: () => void;
}>): ReactNode {
  const [pickerError, setPickerError] = useState<string | undefined>();
  const [viewerPhoto, setViewerPhoto] = useState<PhotoAsset | undefined>();
  const validation = validateSelectedPhotos(photos, failedPhotoIds);
  const validK = Number.isInteger(k) && k >= 1 && k <= photos.length;
  const startable = canStartRanking(photos, k, failedPhotoIds);

  const pickPhotos = async () => {
    setPickerError(undefined);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 0,
        quality: 1,
        base64: false,
      });
      if (!result.canceled) {
        const newPhotos = result.assets.map(assetFromPicker);
        const knownIdentities = new Set(photos.map((photo) => photo.assetId ?? photo.uri));
        const uniquePhotos = newPhotos.filter((photo) => {
          const identity = photo.assetId ?? photo.uri;
          if (knownIdentities.has(identity)) return false;
          knownIdentities.add(identity);
          return true;
        });
        if (uniquePhotos.length !== newPhotos.length) setPickerError('Omitimos fotos duplicadas que el dispositivo pudo identificar.');
        onPhotosChange([...photos, ...uniquePhotos]);
      }
    } catch {
      setPickerError('No pudimos abrir el selector. Revisa el permiso e inténtalo de nuevo.');
    }
  };

  const removePhoto = (photoId: string) => onPhotosChange(photos.filter((photo) => photo.id !== photoId));
  const retryPhoto = (photoId: string) => onRetryPhoto(photoId);

  return (
    <ScreenLayout>
      <Text accessibilityRole="header" style={styles.title}>Prepara tu sesión</Text>
      <Text style={styles.body}>Elige varias fotos y define cuántas favoritas quieres encontrar. La duración se adapta a tus decisiones.</Text>
      <PrimaryButton label="Elegir fotos" onPress={() => { void pickPhotos(); }} />
      {__DEV__ ? <PrimaryButton kind="secondary" label="Cargar 6 fotos de prueba" onPress={() => onPhotosChange(DEVELOPMENT_PHOTO_FIXTURES)} /> : null}
      {pickerError ? <Text accessibilityRole="alert" style={styles.error}>{pickerError}</Text> : null}
      <Text style={styles.sectionTitle}>{photos.length} fotos seleccionadas</Text>
      {photos.length === 0 ? <Text style={styles.note}>Necesitas al menos dos fotos para empezar.</Text> : null}
      <View style={styles.photoList}>
        {photos.map((photo) => {
          const failed = failedPhotoIds.includes(photo.id);
          return (
            <View key={photo.id} style={[styles.setupPhoto, failed && styles.failedPhoto]}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Ampliar ${filename(photo)}`} onPress={() => setViewerPhoto(photo)} style={styles.setupPreview}>
                <PhotoPreview key={`${photo.id}-${failed ? 'failed' : 'ready'}`} photo={photo} onError={() => onPhotoLoadError(photo.id)} onLoad={() => onPhotoLoaded(photo.id)} />
              </Pressable>
              <Text numberOfLines={1} style={styles.filename}>{filename(photo)}</Text>
              {failed ? <Text style={styles.error}>No se pudo cargar</Text> : null}
              {failed ? <PrimaryButton kind="secondary" label={`Reintentar ${filename(photo)}`} onPress={() => retryPhoto(photo.id)} /> : null}
              <PrimaryButton kind="secondary" label={`Quitar ${filename(photo)}`} onPress={() => removePhoto(photo.id)} />
            </View>
          );
        })}
      </View>
      <View style={styles.kPanel}>
        <Text style={styles.sectionTitle}>¿Cuántas fotos quieres en tu Top K?</Text>
        <View style={styles.kControls}>
          <PrimaryButton kind="secondary" disabled={k <= 1} label="Reducir K" onPress={() => onKChange(k - 1)} />
          <TextInput
            accessibilityLabel="Tamaño de Top K"
            keyboardType="number-pad"
            onChangeText={(value) => onKChange(Number.parseInt(value, 10) || 0)}
            selectTextOnFocus
            style={styles.kInput}
            value={String(k)}
          />
          <PrimaryButton kind="secondary" disabled={photos.length === 0 || k >= photos.length} label="Aumentar K" onPress={() => onKChange(k + 1)} />
        </View>
        {!validK ? <Text accessibilityRole="alert" style={styles.error}>K debe estar entre 1 y {Math.max(photos.length, 1)}.</Text> : null}
      </View>
      {validation.messages.map((message) => <Text accessibilityRole="alert" key={message} style={styles.error}>{message}</Text>)}
      <PrimaryButton disabled={!startable} label="Empezar comparaciones" onPress={onStart} />
      <PrimaryButton kind="secondary" label="Volver al inicio" onPress={onBack} />
      <PhotoViewer photo={viewerPhoto} onClose={() => setViewerPhoto(undefined)} />
    </ScreenLayout>
  );
}

function StabilityCopy({ confidence, recommendation }: Readonly<{ confidence: TopKConfidenceResult; recommendation: StopRecommendation }>): ReactNode {
  const label = recommendation.stabilityLevel === 'very-stable'
    ? 'Muy estable'
    : recommendation.stabilityLevel === 'fairly-stable' ? 'Bastante estable' : 'Resultado inicial';
  return (
    <View accessibilityLabel={`Estabilidad: ${label}`} style={styles.stabilityCard}>
      <Text style={styles.stabilityLabel}>{label}</Text>
      <Text style={styles.stabilityBody}>
        {recommendation.reason === 'collecting-coverage'
          ? `Aún damos cobertura a todas las fotos (${Math.round(recommendation.coverage * 100)}%).`
          : `Pertenencia ${Math.round(confidence.membershipStability * 100)}% · orden ${Math.round(confidence.orderStability * 100)}%.`}
      </Text>
    </View>
  );
}

export function ComparisonScreen({
  pair,
  photosById,
  confidence,
  recommendation,
  canUndo,
  onOutcome,
  onUndo,
  onViewResult,
  onPause,
}: Readonly<{
  pair: SelectedPair | undefined;
  photosById: Readonly<Record<string, PhotoAsset>>;
  confidence: TopKConfidenceResult;
  recommendation: StopRecommendation;
  canUndo: boolean;
  onOutcome: (outcome: 'left' | 'right' | 'draw' | 'skip') => void;
  onUndo: () => void;
  onViewResult: () => void;
  onPause: () => void;
}>): ReactNode {
  const [viewerPhoto, setViewerPhoto] = useState<PhotoAsset | undefined>();
  const left = pair ? photosById[pair.leftPhotoId] : undefined;
  const right = pair ? photosById[pair.rightPhotoId] : undefined;
  const isLocked = recommendation.isMaximumReached || !pair || !left || !right;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function' || viewerPhoto || isLocked) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isInput = typeof HTMLInputElement !== 'undefined' && target instanceof HTMLInputElement;
      const isTextArea = typeof HTMLTextAreaElement !== 'undefined' && target instanceof HTMLTextAreaElement;
      if (event.defaultPrevented || isInput || isTextArea) return;
      if (event.key === 'ArrowLeft') onOutcome('left');
      if (event.key === 'ArrowRight') onOutcome('right');
      if (event.key === ' ') { event.preventDefault(); onOutcome('skip'); }
      if (event.key.toLowerCase() === 'z') onUndo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLocked, onOutcome, onUndo, viewerPhoto]);

  return (
    <ScreenLayout>
      <View style={styles.comparisonHeader}>
        <View><Text accessibilityRole="header" style={styles.title}>¿Cuál prefieres?</Text><Text style={styles.note}>{pair?.stage === 'coverage' ? 'Conociendo todas tus fotos' : 'Afinando tu Top K'}</Text></View>
        <PrimaryButton kind="secondary" label="Pausar sesión" onPress={onPause} />
      </View>
      <StabilityCopy confidence={confidence} recommendation={recommendation} />
      {recommendation.isStable ? <View style={styles.successCard}><Text style={styles.successText}>Tu Top K ya está bastante estable.</Text><PrimaryButton label="Ver resultado" onPress={onViewResult} /></View> : null}
      {recommendation.isMaximumReached ? <View style={styles.warningCard}><Text style={styles.warningText}>Alcanzaste el límite de comparaciones. Puedes ver tu resultado actual.</Text><PrimaryButton label="Ver resultado provisional" onPress={onViewResult} /></View> : null}
      {left && right ? (
        <View style={styles.comparisonPhotos}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Ampliar foto izquierda: ${filename(left)}`} disabled={isLocked} onPress={() => setViewerPhoto(left)} style={styles.comparisonPhoto}><PhotoPreview photo={left} /><Text style={styles.comparisonFilename}>{filename(left)}</Text></Pressable>
          <Text style={styles.vs}>VS</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Ampliar foto derecha: ${filename(right)}`} disabled={isLocked} onPress={() => setViewerPhoto(right)} style={styles.comparisonPhoto}><PhotoPreview photo={right} /><Text style={styles.comparisonFilename}>{filename(right)}</Text></Pressable>
        </View>
      ) : <Text style={styles.error}>No encontramos un par válido. Vuelve a configurar la sesión.</Text>}
      <View style={styles.choiceGrid}>
        <PrimaryButton disabled={isLocked} label="Elegir izquierda" onPress={() => onOutcome('left')} />
        <PrimaryButton disabled={isLocked} label="Elegir derecha" onPress={() => onOutcome('right')} />
        <PrimaryButton disabled={isLocked} kind="secondary" label="Iguales" onPress={() => onOutcome('draw')} />
        <PrimaryButton disabled={isLocked} kind="secondary" label="Saltar / No sé" onPress={() => onOutcome('skip')} />
      </View>
      <PrimaryButton disabled={!canUndo || Boolean(viewerPhoto)} kind="secondary" label="Deshacer última decisión" onPress={onUndo} />
      <PrimaryButton kind="secondary" label="Ver Top K provisional" onPress={onViewResult} />
      <Text style={styles.shortcuts}>Web: ← izquierda · → derecha · espacio saltar · Z deshacer</Text>
      <PhotoViewer photo={viewerPhoto} onClose={() => setViewerPhoto(undefined)} />
    </ScreenLayout>
  );
}

export function PausedScreen({ onContinue, onResult, onRestart }: Readonly<{ onContinue: () => void; onResult: () => void; onRestart: () => void }>): ReactNode {
  const [confirming, setConfirming] = useState(false);
  return (
    <ScreenLayout>
      <Text accessibilityRole="header" style={styles.title}>Sesión en pausa</Text>
      <Text style={styles.body}>Tus comparaciones siguen guardadas en esta sesión. Puedes continuar cuando quieras o revisar el resultado provisional.</Text>
      <PrimaryButton label="Continuar comparando" onPress={onContinue} />
      <PrimaryButton kind="secondary" label="Ver Top K provisional" onPress={onResult} />
      <PrimaryButton kind="danger" label="Reiniciar sesión" onPress={() => setConfirming(true)} />
      {confirming ? <ConfirmDialog confirmLabel="Sí, reiniciar" message="Perderás las comparaciones realizadas en esta sesión." onCancel={() => setConfirming(false)} onConfirm={onRestart} title="¿Reiniciar la sesión?" /> : null}
    </ScreenLayout>
  );
}

export function TopKResultScreen({
  rankedPhotos,
  k,
  confidence,
  onContinue,
  onCreateCarousel,
  onUndo,
  onRestart,
}: Readonly<{
  rankedPhotos: readonly PhotoAsset[];
  k: number;
  confidence: TopKConfidenceResult;
  onContinue: () => void;
  onCreateCarousel: () => void;
  onUndo: () => void;
  onRestart: () => void;
}>): ReactNode {
  const [viewerPhoto, setViewerPhoto] = useState<PhotoAsset | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const topPhotos = rankedPhotos.slice(0, k);
  const share = async () => {
    setSharing(true);
    try { await shareSelection(topPhotos); } catch { Alert.alert('No pudimos compartir la selección', 'Puedes intentarlo de nuevo desde este dispositivo.'); } finally { setSharing(false); }
  };
  const shareOriginal = async (photo: PhotoAsset) => {
    try { await sharePhoto(photo); } catch { Alert.alert('No pudimos compartir esta foto', 'Puedes intentarlo de nuevo desde este dispositivo.'); }
  };
  return (
    <ScreenLayout>
      <Text accessibilityRole="header" style={styles.title}>Tu Top {k}</Text>
      <Text style={styles.body}>Este resultado refleja tus elecciones. Puedes seguir comparando si quieres afinarlo.</Text>
      <Text style={styles.note}>Estabilidad de pertenencia: {Math.round(confidence.membershipStability * 100)}% · estabilidad del orden: {Math.round(confidence.orderStability * 100)}%.</Text>
      <View style={styles.resultList}>
        {topPhotos.map((photo, index) => (
          <View key={photo.id} style={styles.resultPhoto}>
            <Text style={styles.rankNumber}>{index + 1}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Ampliar posición ${index + 1}: ${filename(photo)}`} onPress={() => setViewerPhoto(photo)} style={styles.resultPreview}><PhotoPreview photo={photo} /></Pressable><Text style={styles.resultFilename}>{filename(photo)}</Text><PrimaryButton kind="secondary" label={`Compartir ${filename(photo)}`} onPress={() => { void shareOriginal(photo); }} />
          </View>
        ))}
      </View>
      <PrimaryButton disabled={sharing} label={sharing ? 'Abriendo compartir…' : 'Compartir o exportar selección'} onPress={() => { void share(); }} />
      <PrimaryButton label="Seguir comparando" onPress={onContinue} />
      <PrimaryButton kind="secondary" label="Deshacer y volver a comparar" onPress={onUndo} />
      <PrimaryButton kind="secondary" label="Crear carrusel" onPress={onCreateCarousel} />
      <PrimaryButton kind="danger" label="Reiniciar sesión" onPress={() => setConfirming(true)} />
      {confirming ? <ConfirmDialog confirmLabel="Sí, reiniciar" message="Perderás la configuración y todas las comparaciones de esta sesión." onCancel={() => setConfirming(false)} onConfirm={onRestart} title="¿Reiniciar la sesión?" /> : null}
      <PhotoViewer photo={viewerPhoto} onClose={() => setViewerPhoto(undefined)} />
    </ScreenLayout>
  );
}

export function AnalyzingPhotosScreen({
  status,
  progress,
  message,
  onCancel,
  onRetry,
  onBack,
}: Readonly<{
  status: VisualAnalysisScreenStatus;
  progress: Readonly<{ completed: number; total: number; currentPhotoId?: string }>;
  message?: string;
  onCancel: () => void;
  onRetry: () => void;
  onBack: () => void;
}>): ReactNode {
  const percentage = progress.total === 0 ? 0 : Math.round((progress.completed / progress.total) * 100);
  const isWorking = status === 'running' || status === 'cancelling';
  return (
    <ScreenLayout>
      <Text accessibilityRole="header" style={styles.title}>Analizando fotos</Text>
      <Text style={styles.body}>El modelo compara señales visuales únicamente en este dispositivo. Procesamos una foto a la vez; los embeddings permanecen solo en memoria durante esta sesión.</Text>
      <View
        accessibilityLabel={`Progreso del análisis: ${progress.completed} de ${progress.total}`}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: Math.max(progress.total, 1), now: progress.completed }}
        style={styles.analysisCard}
      >
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${percentage}%` }]} /></View>
        <Text style={styles.analysisCount}>{progress.completed} de {progress.total} fotos · {percentage}%</Text>
        {status === 'running' ? <Text style={styles.note}>Preparando e infiriendo localmente…</Text> : null}
        {status === 'cancelling' ? <Text style={styles.note}>Cancelando y liberando recursos…</Text> : null}
      </View>
      {status === 'complete' ? (
        <View style={styles.successCard}>
          <Text style={styles.successText}>Análisis local completado para {progress.completed} fotos.</Text>
          <Text style={styles.note}>La revisión y corrección de grupos se implementará en la fase 5; todavía no se ha construido un carrusel.</Text>
        </View>
      ) : null}
      {status === 'error' ? <View style={styles.warningCard}><Text accessibilityRole="alert" style={styles.warningText}>{message ?? 'No pudimos completar el análisis.'}</Text></View> : null}
      {status === 'running' ? <PrimaryButton kind="secondary" label="Cancelar análisis" onPress={onCancel} /> : null}
      {status === 'error' ? <PrimaryButton label="Reintentar análisis" onPress={onRetry} /> : null}
      {!isWorking ? <PrimaryButton kind="secondary" label="Volver a mi Top K" onPress={onBack} /> : null}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, gap: spacing.md, maxWidth: 920, padding: spacing.lg, width: '100%', alignSelf: 'center' },
  eyebrow: { color: colors.accent, fontSize: 16, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  hero: { color: colors.ink, fontSize: 44, fontWeight: '800', lineHeight: 52 },
  title: { color: colors.ink, fontSize: 32, fontWeight: '800', lineHeight: 40 },
  body: { color: colors.muted, fontSize: 17, lineHeight: 25 },
  note: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '700' },
  primaryButton: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: 14, justifyContent: 'center', minHeight: 50, paddingHorizontal: spacing.md },
  dangerButton: { alignItems: 'center', backgroundColor: '#B23A3A', borderRadius: 14, justifyContent: 'center', minHeight: 50, paddingHorizontal: spacing.md },
  secondaryButton: { alignItems: 'center', borderColor: colors.border, borderRadius: 14, borderWidth: 1, justifyContent: 'center', minHeight: 50, paddingHorizontal: spacing.md },
  disabledButton: { opacity: 0.45 }, primaryLabel: { color: colors.accentText, fontSize: 16, fontWeight: '700' }, secondaryLabel: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  error: { color: '#A42D2D', fontSize: 14, fontWeight: '600', lineHeight: 20 },
  photoList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, setupPhoto: { backgroundColor: '#FFFFFF', borderColor: colors.border, borderRadius: 12, borderWidth: 1, gap: 6, padding: 8, width: 152 }, failedPhoto: { borderColor: '#B23A3A', borderWidth: 2 }, setupPreview: { aspectRatio: 1, overflow: 'hidden', borderRadius: 8 }, filename: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  kPanel: { backgroundColor: '#FFFFFF', borderColor: colors.border, borderRadius: 14, borderWidth: 1, gap: spacing.sm, padding: spacing.md }, kControls: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' }, kInput: { borderColor: colors.border, borderRadius: 10, borderWidth: 1, color: colors.ink, fontSize: 22, fontWeight: '800', minWidth: 62, padding: 9, textAlign: 'center' },
  viewerBackdrop: { alignItems: 'center', backgroundColor: 'rgba(14, 20, 29, 0.85)', flex: 1, justifyContent: 'center', padding: spacing.lg }, viewerCard: { backgroundColor: colors.canvas, borderRadius: 18, gap: spacing.md, maxHeight: '88%', maxWidth: 760, padding: spacing.md, width: '100%' }, viewerImage: { aspectRatio: 1, backgroundColor: '#172032', borderRadius: 12, overflow: 'hidden' }, viewerFilename: { color: colors.ink, fontSize: 16, fontWeight: '700', textAlign: 'center' }, confirmCard: { backgroundColor: colors.canvas, borderRadius: 18, gap: spacing.md, maxWidth: 500, padding: spacing.lg, width: '100%' }, confirmTitle: { color: colors.ink, fontSize: 24, fontWeight: '800' },
  comparisonHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' }, stabilityCard: { backgroundColor: '#EEF1FF', borderRadius: 12, gap: 3, padding: spacing.md }, stabilityLabel: { color: '#34468F', fontSize: 16, fontWeight: '800' }, stabilityBody: { color: colors.muted, fontSize: 14, lineHeight: 20 }, successCard: { backgroundColor: '#E6F6EC', borderRadius: 12, gap: spacing.sm, padding: spacing.md }, successText: { color: '#166534', fontSize: 16, fontWeight: '800' }, warningCard: { backgroundColor: '#FFF4DD', borderRadius: 12, gap: spacing.sm, padding: spacing.md }, warningText: { color: '#8A4B00', fontSize: 16, fontWeight: '800' },
  comparisonPhotos: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' }, comparisonPhoto: { aspectRatio: 0.72, backgroundColor: '#E8EBEF', borderRadius: 14, flex: 1, maxWidth: 390, overflow: 'hidden' }, comparisonFilename: { backgroundColor: 'rgba(255,255,255,0.9)', color: colors.ink, fontSize: 13, fontWeight: '700', padding: 8, textAlign: 'center' }, vs: { color: colors.muted, fontSize: 16, fontWeight: '900' }, choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, shortcuts: { color: colors.muted, fontSize: 12, textAlign: 'center' },
  resultList: { gap: spacing.sm }, resultPhoto: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: colors.border, borderRadius: 12, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, minHeight: 92, padding: 8 }, rankNumber: { color: colors.accent, fontSize: 28, fontWeight: '900', minWidth: 26, textAlign: 'center' }, resultPreview: { height: 72, overflow: 'hidden', borderRadius: 8, width: 72 }, resultFilename: { color: colors.ink, flex: 1, fontSize: 16, fontWeight: '700' },
  analysisCard: { backgroundColor: '#FFFFFF', borderColor: colors.border, borderRadius: 14, borderWidth: 1, gap: spacing.sm, padding: spacing.md }, analysisCount: { color: colors.ink, fontSize: 18, fontWeight: '800' }, progressTrack: { backgroundColor: '#E2E8F0', borderRadius: 999, height: 12, overflow: 'hidden' }, progressFill: { backgroundColor: colors.accent, borderRadius: 999, height: '100%' },
});
