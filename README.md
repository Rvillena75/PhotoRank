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
npm run benchmark:ranking
```

`npm run start` abre Expo orientado a Development Builds. Para Web usa `npm run web`.

`npm install` también copia y verifica el binario WASM exacto usado por
`onnxruntime-web`. Además aplica de forma determinista la corrección oficial de
compatibilidad con Gradle 9 a `onnxruntime-react-native` 1.24.3. El proceso
verifica la versión y el código esperado antes de modificar `node_modules`, y
falla si la dependencia cambia. El build no descarga runtime ni modelo durante
el uso.

En WSL/Linux, `npm run test:e2e` necesita las bibliotecas de sistema de Chromium.
Si Playwright informa dependencias ausentes, instálalas con el comando anterior;
omitir su chequeo no sustituye esas bibliotecas.

Para generar el binario de desarrollo activo, `eas.json` define el perfil `development` con `expo-dev-client`. Tras autenticar EAS y tener las credenciales de Android, ejecuta `npx eas-cli build --profile development --platform android`.

Web y Android son las plataformas activas. El bundle Metro/Hermes de Android se
validó. El primer Development Build en EAS detectó la incompatibilidad conocida
entre `onnxruntime-react-native` 1.24.3 y Gradle 9; el repositorio incluye el
parche reproducible basado en la corrección de Microsoft. Un segundo build
limpio con ese parche terminó correctamente y generó el APK de desarrollo
(`d4e881a3-7edd-46b3-8309-15b695b61a66`). La instalación, ejecución de la
inferencia y paridad numérica en un dispositivo Android físico siguen
pendientes. iOS permanece como plataforma planificada, pero su desarrollo y
validación están pausados; el código y la configuración existentes se conservan
para retomarlos después. El estado exacto está en
`docs/IMAGE_SIMILARITY.md`.

## Fase 4 implementada

El flujo disponible es Home → Setup → Comparaciones → pausa opcional → Resultado Top K → análisis visual local.

- El selector del sistema permite varias fotos. Se valida el mínimo de dos, `1 <= K <= N`, duplicados identificables por `assetId` o URI y errores de carga. Las fotos originales no se convierten ni guardan como Base64.
- El resultado de cada duelo puede ser izquierda, derecha, iguales o saltar. `Deshacer` reconstruye la sesión desde el historial inmutable.
- El motor de confianza hace 1.000 simulaciones Monte Carlo deterministas al recibir un RNG inyectado. Expone por separado estabilidad de pertenencia y de orden; con `K=N` usa solo el orden como señal útil.
- El progreso requiere una comparación informativa por foto, evidencia mínima y estabilidad de pertenencia con histéresis. `2N` es un checkpoint: el usuario puede ver el resultado o continuar en bloques de `0,5N`. A `4N`, si persiste la ambigüedad, confirma manualmente exactamente K fotos sin alterar el posterior.
- Para el piloto, desde 20 decisiones y con cobertura completa aparece **Terminar y revisar mi Top K**. Permite confirmar o reemplazar las K sugeridas sin esperar al límite; se puede seguir comparando. La confirmación voluntaria se conserva separada de la estabilidad automática.
- El resultado permite ampliar cada foto, compartir su archivo original mediante la hoja del sistema y compartir/exportar localmente un manifiesto de toda la selección (nombres y orden, sin bytes de las fotos ni rutas). El fallback comparte el texto.
- En desarrollo, el setup ofrece seis fixtures visuales locales para recorrer el flujo sin abrir repetidamente el selector. No se muestran en builds de producción.
- `Crear carrusel` inicia el análisis de todas las fotos válidas de la sesión, una por una. Muestra progreso, permite cancelar y reintentar, y libera sesión, tensores y archivos temporales.
- Web ejecuta el modelo empaquetado con `onnxruntime-web` WASM/CPU. Android usa `onnxruntime-react-native` exclusivamente en Development Builds; el mismo adaptador queda preservado para iOS cuando se retome.
- El modelo se valida contra `MODEL_MANIFEST.json` y su SHA-256 antes de crear la sesión. Las salidas deben ser `float32 [1,576]`, finitas y L2-normalizadas.
- Un fallo o cancelación borra embeddings parciales y conserva el ranking y el Top K. Los embeddings solo viven en memoria y no se persisten.

La matriz de similitud, clustering, revisión de grupos y MMR siguen fuera de alcance y comienzan en las fases 5 y 6. El final de esta fase vuelve al Top K y no ofrece un fallback manual que simule una recomendación.

## Benchmark sintético de ranking y carrusel

`npm run benchmark:ranking` ejecuta sesiones completas sin cargar imágenes. Usa
ids ficticios, tiers de preferencia y grupos declarados; genera perfiles
determinista, consistente, habitual y ambiguo con `skip`, `draw`, sesgo de lado
y contradicciones reproducibles. El reporte JSON se escribe en
`local-data/ranking/benchmark/latest.json`, que permanece ignorado por Git.

El benchmark compara el comportamiento actual con variantes de cobertura,
frontera y `expectedTopKOverlap`. También informa una comparación de contrato
entre usar el Top K directamente como carrusel y una referencia de una foto por
grupo. Esto no valida todavía el MMR de producción: agrupamiento y carrusel
siguen pendientes de las fases 5 y 6.

Las conclusiones, resultados y agenda para el siguiente agente están en
[`docs/RANKING_BENCHMARK_CONCLUSIONS.md`](docs/RANKING_BENCHMARK_CONCLUSIONS.md).

Para ajustar el costo de una corrida:

```bash
PHOTORANK_BENCHMARK_SESSIONS=20 PHOTORANK_BENCHMARK_SAMPLES=1000 npm run benchmark:ranking
```

Los tiempos de interacción del reporte son una hipótesis configurable por
perfil. Para calibrar tiempo humano real hay que reemplazar esos parámetros con
mediciones de sesiones locales; el número de decisiones y la precisión sí son
las métricas principales del simulador.

Consulta `docs/IMAGE_SIMILARITY.md`, `docs/ARCHITECTURE.md` y `tools/model-export/README.md` para los contratos, hashes y reproducción.

## Privacidad

La aplicación no incluye backend, autenticación, telemetría ni inferencia remota. Las fotos, thumbnails, embeddings, ratings y metadata sensible no se suben; los embeddings del análisis no se guardan.
