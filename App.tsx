import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import {
  INITIAL_STOP_RECOMMENDATION_STATE,
  MonteCarloTopKConfidenceEstimator,
  createSeededRandom,
  evaluateStopRecommendation,
  seedFromText,
} from './src/domain/confidence';
import type { StopRecommendation, TopKConfidenceResult } from './src/domain/confidence';
import { AdaptivePairSelectionEngine } from './src/domain/pair-selection';
import {
  applyComparison,
  createManualTopKResolution,
  createRankingSession,
  getTopK,
  rankPhotoIds,
  undoLastComparison,
} from './src/domain/rating';
import type { ComparisonOutcome, ManualTopKResolution, RankingSession } from './src/domain/rating';
import { TsTrueSkillRatingEngine } from './src/infrastructure/rating';
import {
  ComparisonScreen,
  BoundaryResolutionScreen,
  HomeScreen,
  AnalyzingPhotosScreen,
  PausedScreen,
  SetupScreen,
  TopKResultScreen,
} from './src/features';
import type { FlowScreen } from './src/features';
import type { ImageEmbeddingEngine, PhotoAsset } from './src/domain/contracts';
import {
  VisualAnalysisRunner,
  visualAnalysisErrorMessage,
} from './src/infrastructure/image-embedding';
import type { VisualAnalysisProgress } from './src/infrastructure/image-embedding';
import { colors } from './src/theme';

const ratingEngine = new TsTrueSkillRatingEngine();
const pairSelectionEngine = new AdaptivePairSelectionEngine();
const confidenceEstimator = new MonteCarloTopKConfidenceEstimator();

function simulationSeed(session: RankingSession, k: number): number {
  const eventText = session.history.filter((record) => record.outcome.type !== 'skip')
    .map((record) => `${record.leftPhotoId}:${record.rightPhotoId}:${record.outcome.type}`).join('|');
  return seedFromText(`${k}|${session.photoIds.join('|')}|${eventText}`);
}

async function createPlatformEmbeddingEngine(): Promise<ImageEmbeddingEngine> {
  const module = await import('./src/infrastructure/image-embedding/create-image-embedding-engine');
  return module.createImageEmbeddingEngine();
}

type VisualAnalysisStatus = 'idle' | 'running' | 'cancelling' | 'complete' | 'error';

export interface AppProps {
  readonly createEmbeddingEngine?: () => Promise<ImageEmbeddingEngine>;
}

export default function App({ createEmbeddingEngine = createPlatformEmbeddingEngine }: AppProps) {
  const [screen, setScreen] = useState<FlowScreen>('home');
  const [photos, setPhotos] = useState<readonly PhotoAsset[]>([]);
  const [failedPhotoIds, setFailedPhotoIds] = useState<readonly string[]>([]);
  const [k, setK] = useState(5);
  const [session, setSession] = useState<RankingSession | undefined>();
  const [confidence, setConfidence] = useState<TopKConfidenceResult | undefined>();
  const [stopState, setStopState] = useState(INITIAL_STOP_RECOMMENDATION_STATE);
  const [recommendation, setRecommendation] = useState<StopRecommendation | undefined>();
  const [manualResolution, setManualResolution] = useState<ManualTopKResolution | undefined>();
  const [analysisStatus, setAnalysisStatus] = useState<VisualAnalysisStatus>('idle');
  const [analysisProgress, setAnalysisProgress] = useState<VisualAnalysisProgress>({ completed: 0, total: 0 });
  const [analysisMessage, setAnalysisMessage] = useState<string | undefined>();
  const analysisAttemptRef = useRef(0);
  const analysisRunnerRef = useRef<VisualAnalysisRunner | null>(null);
  if (analysisRunnerRef.current === null) analysisRunnerRef.current = new VisualAnalysisRunner(createEmbeddingEngine);

  useEffect(() => () => {
    analysisAttemptRef.current += 1;
    analysisRunnerRef.current?.clear();
  }, []);

  const photosById = useMemo(() => Object.freeze(Object.fromEntries(photos.map((photo) => [photo.id, photo]))) as Readonly<Record<string, PhotoAsset>>, [photos]);
  const pair = useMemo(
    () => session ? pairSelectionEngine.selectNextPair({ ...session, k }) : undefined,
    [session, k],
  );
  const rankedPhotos = useMemo(() => {
    if (!session) return [];
    return rankPhotoIds(session.ratings).map((photoId) => photosById[photoId]).filter((photo): photo is PhotoAsset => photo !== undefined);
  }, [photosById, session]);
  const topPhotos = useMemo(() => {
    if (!session) return [];
    const selectedPhotoIds = manualResolution?.selectedPhotoIds ?? getTopK(session, k);
    return selectedPhotoIds.map((photoId) => photosById[photoId]).filter((photo): photo is PhotoAsset => photo !== undefined);
  }, [k, manualResolution, photosById, session]);

  const updatePhotos = (nextPhotos: readonly PhotoAsset[]) => {
    setPhotos(Object.freeze([...nextPhotos]));
    setFailedPhotoIds((current) => current.filter((photoId) => nextPhotos.some((photo) => photo.id === photoId)));
    if (nextPhotos.length > 0 && k > nextPhotos.length) setK(nextPhotos.length);
  };

  const startRanking = () => {
    const rankingSession = createRankingSession(photos.map((photo) => photo.id), ratingEngine);
    const initialConfidence = confidenceEstimator.estimate(rankingSession, k, createSeededRandom(simulationSeed(rankingSession, k)));
    const initialStop = evaluateStopRecommendation(rankingSession, initialConfidence, INITIAL_STOP_RECOMMENDATION_STATE);
    setSession(rankingSession);
    setConfidence(initialConfidence);
    setStopState(initialStop.state);
    setRecommendation(initialStop.recommendation);
    setManualResolution(undefined);
    setScreen('comparison');
  };

  const recordOutcome = (type: ComparisonOutcome['type']) => {
    if (!session || !pair || recommendation?.canContinueComparing === false) return;
    const nextSession = applyComparison(session, {
      id: `comparison-${session.history.length + 1}`,
      leftPhotoId: pair.leftPhotoId,
      rightPhotoId: pair.rightPhotoId,
      outcome: { type },
      createdAt: Date.now(),
    }, ratingEngine);
    const nextConfidence = type === 'skip' && confidence
      ? confidence
      : confidenceEstimator.estimate(nextSession, k, createSeededRandom(simulationSeed(nextSession, k)));
    const nextStop = evaluateStopRecommendation(nextSession, nextConfidence, stopState);
    setSession(nextSession);
    setConfidence(nextConfidence);
    setStopState(nextStop.state);
    setRecommendation(nextStop.recommendation);
    setManualResolution(undefined);
  };

  const undo = () => {
    if (!session) return;
    const nextSession = undoLastComparison(session, ratingEngine);
    const nextConfidence = session.history.at(-1)?.outcome.type === 'skip' && confidence
      ? confidence
      : confidenceEstimator.estimate(nextSession, k, createSeededRandom(simulationSeed(nextSession, k)));
    const nextStop = evaluateStopRecommendation(nextSession, nextConfidence, INITIAL_STOP_RECOMMENDATION_STATE);
    setSession(nextSession);
    setConfidence(nextConfidence);
    setStopState(nextStop.state);
    setRecommendation(nextStop.recommendation);
    setManualResolution(undefined);
    setScreen('comparison');
  };

  const restart = () => {
    analysisAttemptRef.current += 1;
    analysisRunnerRef.current?.clear();
    setSession(undefined);
    setConfidence(undefined);
    setStopState(INITIAL_STOP_RECOMMENDATION_STATE);
    setRecommendation(undefined);
    setManualResolution(undefined);
    setAnalysisStatus('idle');
    setAnalysisMessage(undefined);
    setScreen('setup');
  };

  const startVisualAnalysis = () => {
    const runner = analysisRunnerRef.current;
    if (!runner) return;
    const attempt = analysisAttemptRef.current + 1;
    analysisAttemptRef.current = attempt;
    setAnalysisStatus('running');
    setAnalysisMessage(undefined);
    setAnalysisProgress({ completed: 0, total: photos.length });
    setScreen('visual-analysis');
    void runner.analyze(photos, (progress) => {
      if (analysisAttemptRef.current === attempt) setAnalysisProgress(progress);
    }).then((result) => {
      if (analysisAttemptRef.current !== attempt) return;
      setAnalysisProgress({ completed: result.processedPhotoIds.length, total: result.processedPhotoIds.length });
      setAnalysisStatus('complete');
    }).catch((error: unknown) => {
      if (analysisAttemptRef.current !== attempt) return;
      setAnalysisMessage(visualAnalysisErrorMessage(error));
      setAnalysisStatus('error');
    });
  };

  const cancelVisualAnalysis = () => {
    if (analysisStatus !== 'running') return;
    setAnalysisStatus('cancelling');
    analysisRunnerRef.current?.cancel();
  };

  const returnToTopK = () => {
    analysisAttemptRef.current += 1;
    analysisRunnerRef.current?.clear();
    setAnalysisStatus('idle');
    setAnalysisMessage(undefined);
    setScreen('top-k-result');
  };

  const loadError = (photoId: string) => setFailedPhotoIds((current) => current.includes(photoId) ? current : Object.freeze([...current, photoId]));
  const retryPhoto = (photoId: string) => setFailedPhotoIds((current) => current.includes(photoId) ? Object.freeze(current.filter((id) => id !== photoId)) : current);

  const resolveTopK = (selectedPhotoIds: readonly string[]) => {
    if (!session || !recommendation?.canReviewSelection) return;
    const source = recommendation.requiresManualResolution ? 'hard-limit' : 'user-confirmation';
    setManualResolution(createManualTopKResolution(session, k, selectedPhotoIds, Date.now(), source));
    setScreen('top-k-result');
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.container}>
          {screen === 'home' ? <HomeScreen onStart={() => setScreen('setup')} /> : null}
          {screen === 'setup' ? <SetupScreen
            failedPhotoIds={failedPhotoIds}
            k={k}
            onBack={() => setScreen('home')}
            onKChange={setK}
            onPhotoLoadError={loadError}
            onPhotoLoaded={retryPhoto}
            onPhotosChange={updatePhotos}
            onRetryPhoto={retryPhoto}
            onStart={startRanking}
            photos={photos}
          /> : null}
          {screen === 'comparison' && session && confidence && recommendation ? <ComparisonScreen
            canUndo={session.history.length > 0}
            comparisonCount={session.history.length}
            confidence={confidence}
            k={k}
            onOutcome={recordOutcome}
            onPause={() => setScreen('paused')}
            onResolve={() => setScreen('boundary-resolution')}
            onUndo={undo}
            onViewResult={() => setScreen('top-k-result')}
            pair={pair}
            photosById={photosById}
            recommendation={recommendation}
          /> : null}
          {screen === 'boundary-resolution' && session ? <BoundaryResolutionScreen
            initialSelectedPhotoIds={manualResolution?.selectedPhotoIds ?? getTopK(session, k)}
            k={k}
            onConfirm={resolveTopK}
            onViewProvisional={() => setScreen('top-k-result')}
            rankedPhotos={rankedPhotos}
          /> : null}
          {screen === 'paused' ? <PausedScreen onContinue={() => setScreen('comparison')} onRestart={restart} onResult={() => setScreen('top-k-result')} /> : null}
          {screen === 'top-k-result' && confidence ? <TopKResultScreen
            confidence={confidence}
            canContinue={recommendation?.canContinueComparing ?? true}
            canReviewSelection={Boolean(recommendation?.canReviewSelection && !manualResolution)}
            k={k}
            onContinue={() => setScreen('comparison')}
            onCreateCarousel={startVisualAnalysis}
            onRestart={restart}
            onResolve={() => setScreen('boundary-resolution')}
            onUndo={undo}
            rankedPhotos={topPhotos}
            requiresManualResolution={Boolean(recommendation?.requiresManualResolution && !manualResolution)}
            wasManuallyResolved={Boolean(manualResolution)}
          /> : null}
          {screen === 'visual-analysis' ? <AnalyzingPhotosScreen
            message={analysisMessage}
            onBack={returnToTopK}
            onCancel={cancelVisualAnalysis}
            onRetry={startVisualAnalysis}
            progress={analysisProgress}
            status={analysisStatus}
          /> : null}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  container: { flex: 1 },
});
