# PhotoRank

Aplicación local-first para ordenar fotos por preferencia y preparar localmente señales visuales para un carrusel diverso. Esta entrega implementa la **Fase 4: Pipeline visual local** sin clustering ni recomendación de carrusel.

## Requisitos

- Node.js 22 o superior.
- npm.
- Python 3.12 para regenerar o verificar el modelo.
- Para el Development Build activo: Android Studio o una cuenta/configuración de EAS para Android. Xcode y las credenciales de Apple solo serán necesarios cuando se retome iOS.
- Para el E2E Web: Chromium de Playwright y sus dependencias (`npx playwright install chromium` y, en Linux, `sudo npx playwright install-deps chromium`).

## Comandos

```bash
npm install
npm run start
npm run web
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

`npm run start` abre Expo orientado a Development Builds. Para Web usa `npm run web`.

`npm install` también copia y verifica el binario WASM exacto usado por
`onnxruntime-web`; el build no descarga runtime ni modelo durante el uso.

En WSL/Linux, `npm run test:e2e` necesita las bibliotecas de sistema de Chromium.
Si Playwright informa dependencias ausentes, instálalas con el comando anterior;
omitir su chequeo no sustituye esas bibliotecas.

Para generar el binario de desarrollo activo, `eas.json` define el perfil `development` con `expo-dev-client`. Tras autenticar EAS y tener las credenciales de Android, ejecuta `npx eas-cli build --profile development --platform android`.

Web y Android son las plataformas activas. El bundle Metro/Hermes de Android se
validó, pero su Development Build y la prueba en dispositivo siguen pendientes
por falta del toolchain y hardware nativos en este entorno. iOS permanece como
plataforma planificada, pero su desarrollo y validación están pausados; el
código y la configuración existentes se conservan para retomarlos después. El
estado exacto está en `docs/IMAGE_SIMILARITY.md`.

## Fase 4 implementada

El flujo disponible es Home → Setup → Comparaciones → pausa opcional → Resultado Top K → análisis visual local.

- El selector del sistema permite varias fotos. Se valida el mínimo de dos, `1 <= K <= N`, duplicados identificables por `assetId` o URI y errores de carga. Las fotos originales no se convierten ni guardan como Base64.
- El resultado de cada duelo puede ser izquierda, derecha, iguales o saltar. `Deshacer` reconstruye la sesión desde el historial inmutable.
- El motor de confianza hace 1.000 simulaciones Monte Carlo deterministas al recibir un RNG inyectado. Expone por separado estabilidad de pertenencia y de orden; con `K=N` usa solo el orden como señal útil.
- El progreso requiere cobertura inicial, evidencia mínima y umbrales con histéresis. Hay un máximo de 100 decisiones y siempre se puede ver un resultado provisional, pausar, continuar o reiniciar tras confirmar.
- El resultado permite ampliar cada foto, compartir su archivo original mediante la hoja del sistema y compartir/exportar localmente un manifiesto de toda la selección (nombres y orden, sin bytes de las fotos ni rutas). El fallback comparte el texto.
- En desarrollo, el setup ofrece seis fixtures visuales locales para recorrer el flujo sin abrir repetidamente el selector. No se muestran en builds de producción.
- `Crear carrusel` inicia el análisis de todas las fotos válidas de la sesión, una por una. Muestra progreso, permite cancelar y reintentar, y libera sesión, tensores y archivos temporales.
- Web ejecuta el modelo empaquetado con `onnxruntime-web` WASM/CPU. Android usa `onnxruntime-react-native` exclusivamente en Development Builds; el mismo adaptador queda preservado para iOS cuando se retome.
- El modelo se valida contra `MODEL_MANIFEST.json` y su SHA-256 antes de crear la sesión. Las salidas deben ser `float32 [1,576]`, finitas y L2-normalizadas.
- Un fallo o cancelación borra embeddings parciales y conserva el ranking y el Top K. Los embeddings solo viven en memoria y no se persisten.

La matriz de similitud, clustering, revisión de grupos y MMR siguen fuera de alcance y comienzan en las fases 5 y 6. El final de esta fase vuelve al Top K y no ofrece un fallback manual que simule una recomendación.

Consulta `docs/IMAGE_SIMILARITY.md`, `docs/ARCHITECTURE.md` y `tools/model-export/README.md` para los contratos, hashes y reproducción.

## Privacidad

La aplicación no incluye backend, autenticación, telemetría ni inferencia remota. Las fotos, thumbnails, embeddings, ratings y metadata sensible no se suben; los embeddings del análisis no se guardan.
