# Architecture

## Fase 4: pipeline visual local

`ImageEmbeddingEngine` sigue siendo un contrato de dominio sin referencias a
ONNX Runtime. La infraestructura elige el adaptador por plataforma:

```text
src/domain/contracts.ts
  ImageEmbeddingEngine
        │
        ├─ src/infrastructure/image-embedding/web/
        │    onnxruntime-web + canvas/ImageBitmap
        └─ src/infrastructure/image-embedding/native/
             onnxruntime-react-native + expo-image-manipulator
```

`VisualAnalysisRunner` crea un motor por intento, analiza secuencialmente todas
las fotos válidas, publica progreso y siempre dispone la sesión en `finally`.
Cancelación, fallo o salida limpian los embeddings en memoria; el preprocesador
nativo elimina además su PNG temporal. La UI solo conserva progreso y estado,
por lo que un fallo visual no modifica la sesión de ranking ni el Top K.

El modelo y el runtime WASM son assets empaquetados. En cada inicialización se
verifica el SHA-256 completo del ONNX; el manifiesto tipado fija nombre, versión,
preprocesamiento, nombres, tipos y shapes. Web usa WASM/CPU con un hilo; Android
usa el runtime nativo dentro de Development Builds. La misma ruta nativa se
conserva para iOS, cuya validación está pausada. Ningún adaptador usa ONNX Runtime
Extensions.

La similitud, matriz, agrupamiento y MMR permanecen sin implementar.

## Fases 2–3: Top K

El dominio continúa separado de React Native:

```text
src/domain/rating/          sesión inmutable y Top K determinista
src/domain/pair-selection/  siguiente comparación adaptativa
src/domain/confidence/      Monte Carlo, RNG y criterio de parada puro
src/infrastructure/rating/  único adaptador de ts-trueskill
src/features/photo-picker/  validación de selección y fixtures de desarrollo
src/features/ranking/       exportación local del manifiesto Top K
src/components/             presentación de una foto
```

`App.tsx` conserva únicamente estado efímero de interfaz —fotos seleccionadas, K, pantalla, sesión y progreso visual— y coordina los casos de uso. No calcula ratings, prioridades, simulaciones, preprocesamiento ni inferencia. `src/features/index.tsx` presenta las pantallas y se comunica mediante callbacks tipados.

Las fotos originales permanecen referenciadas por URI local. La exportación crea un archivo de texto temporal con posición y nombre, sin URI ni bytes de imágenes, y usa la hoja de compartir local cuando está disponible.

PhotoRank usa Expo + React Native + TypeScript estricto desde una única base. Web y Android son las plataformas activas; la configuración y los adaptadores iOS se preservan, pero su desarrollo y validación están pausados. `src/features` contiene las pantallas y `src/theme` centraliza tokens visuales. El ranking vive en `src/domain/rating`, `src/domain/pair-selection` y `src/domain/confidence`, sin dependencias de React Native; `src/infrastructure/rating` encapsula `ts-trueskill` detrás de la interfaz propia `RatingEngine`.

La estructura objetivo conserva límites entre UI, dominio e infraestructura:

```text
src/components/
src/features/{photo-picker,ranking,group-review,carousel}/
src/domain/{rating,pair-selection,confidence,similarity,grouping,carousel}/
src/infrastructure/image-embedding/{native,web}/
src/infrastructure/persistence/
src/hooks/ src/state/ src/utils/ src/theme/
```

Ratings, sesión por eventos, reconstrucción, Top K, selección de pares y confianza son servicios puros. Los parámetros están en `src/domain/ranking-config.ts`; los eventos son la fuente reconstruible y `undo` no invierte matemáticamente un posterior. Similitud, agrupamiento y recomendación siguen como contratos futuros. ONNX Runtime aparece únicamente detrás de `ImageEmbeddingEngine` en infraestructura. `expo-dev-client` está configurado en `app.json` y `eas.json` aporta el perfil `development`; Android debe abrirse mediante Development Build, nunca Expo Go. La misma exigencia volverá a aplicar a iOS cuando se levante su pausa.
