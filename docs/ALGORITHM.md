# Ranking algorithms

La revisión de rapidez y las correcciones posteriores del evaluador están en
[`RANKING_SPEED_REVIEW.md`](RANKING_SPEED_REVIEW.md). La variante de producción
del benchmark usa la parada de dominio; `legacy-stop.ts` conserva la regla
histórica. Los resultados numéricos anteriores se mantienen como históricos.

Las fases 2 y 3 implementan ranking probabilístico, historial, `undo`, Top K provisional, selección adaptativa, confianza Monte Carlo y criterio de detención como TypeScript puro. Los módulos de dominio no importan React Native. La fase 4 añade ONNX únicamente detrás de `ImageEmbeddingEngine`; clustering y carrusel permanecen fuera de alcance.

## Benchmark sintético

`tools/ranking-benchmark/` ejecuta el mismo `RatingEngine`, selector adaptativo
y estimador Monte Carlo de producción sobre ids ficticios, sin necesitar archivos
de imagen. Una fixture declara tiers ordenados y grupos; un simulador con semilla
inyectada genera procesos deterministas, consistentes, habituales y ambiguos con
draw, skip, sesgo de lado y contradicciones.

El reporte separa decisiones presentadas, comparaciones informativas y tiempo de
interacción modelado. Para fidelidad informa solapamiento canónico y tolerante a
tiers, recall de las primeras tres, orden tolerante a tiers, estabilidad declarada
y su error de calibración. El criterio principal no es coincidencia exacta del
orden: fotos del mismo tier son equivalentes.

La evaluación `group-diverse-reference` es un contrato previo a MMR: selecciona
una foto por grupo para medir el costo de usar el Top K directamente y comprobar
las invariantes del futuro carrusel. No es todavía `CarouselRecommendationEngine`
ni una validación del MMR real.

La auditoría de 2026-08-11 corrigió ids objetivo correlacionados con el desempate,
seeds distintos por variante y un `recall@3` que exigía orden interno. También
añadió un holdout de 25 fotos y controles que aíslan selector, parada y
presupuesto. Se evaluaron selectores de ganancia de información, Top-Two
Thompson, evidencia balanceada y un posterior Bradley–Terry global. Todos son
candidatos de investigación accesibles desde el benchmark; ninguno está
conectado a la aplicación ni superó la frontera del baseline. La decisión de
producción demostró que los gates de fidelidad y un límite rígido `2N` eran
incompatibles bajo los perfiles ruidosos. Por decisión de producto, `2N` pasó a
ser checkpoint y no límite. Véase
`docs/RANKING_BENCHMARK_CONCLUSIONS.md`.

## Límites y contratos

- `src/domain/rating`: tipos, interfaz `RatingEngine`, sesión por eventos, reconstrucción y Top K.
- `src/infrastructure/rating`: único adaptador que importa `ts-trueskill`.
- `src/domain/pair-selection`: interfaz `PairSelectionEngine` e implementación adaptativa.
- `src/domain/confidence`: estimador Monte Carlo, RNG inyectable y recomendación de detención.
- `src/domain/ranking-config.ts`: parámetros de rating, selector, confianza e histéresis.

La UI futura consumirá estos contratos; no conocerá `Rating`, `TrueSkill` ni funciones de la dependencia.

## Compatibilidad de `ts-trueskill`

Se adoptó `ts-trueskill` 5.0.1 exacto tras comprobar que publica tipos, ESM ES2020 y admite el runtime Node 22 del proyecto. Se prefirió 5.0.1 sobre 5.1.0 porque esta última instala una rama de `mathjs` afectada por avisos de seguridad; 5.0.1 usa `mathjs` 12.4.3. `uuid` se fuerza a 11.1.1 —la misma major adoptada por `ts-trueskill` 5.1— para incluir su corrección de seguridad. La prueba de ejecución 1-vs-1 produjo posteriores finitos y el adaptador se empaquetó con Metro para Web, iOS y Android.

`uuid` necesita `crypto.getRandomValues`; Web y Node usan su implementación
nativa y el adaptador carga `react-native-get-random-values` 2.0.0 solo cuando la
ruta nativa lo necesita. El shim es compatible con React Native >=0.81 y tiene
entrada no-op para Web. Jest necesita transformar `ts-trueskill`, `ts-gaussian` y
`uuid` porque son ESM; la lista está declarada en `package.json` y los tests usan
el adaptador real, no un mock.

El adaptador `TsTrueSkillRatingEngine` crea un entorno con los parámetros centralizados:

| Parámetro | Valor inicial |
| --- | ---: |
| `mu` | 25 |
| `sigma` | 25 / 3 |
| `beta` | 25 / 6 |
| `tau` | 25 / 300 |
| probabilidad de empate | 0.1 |
| multiplicador conservador | 3 |

`conservativeScore = mu - 3 * sigma` se expone como señal derivada, pero no reemplaza `mu` ni representa la probabilidad de inclusión.

## Resultados e historial

- `left` y `right` actualizan ambos posteriores y las estadísticas `matches`, `wins` y `losses`.
- `draw` usa el empate nativo de TrueSkill, incrementa `matches`/`draws`, conserva simetría con priors iguales y aproxima priors diferentes.
- `skip` registra el evento, pero conserva exactamente el objeto de ratings y no altera estadísticas.
- una derrota solo aporta evidencia: nunca elimina una foto.

Cada decisión es un `ComparisonRecord` con id, ids izquierdo/derecho, outcome y timestamp inyectados. La sesión, ratings, historial, eventos y outcomes devueltos están congelados y cada transición produce un valor nuevo. Los ids se validan y una foto no puede enfrentarse consigo misma.

`undo` elimina el evento más reciente y reconstruye todos los posteriores desde los priors y los eventos restantes. Esta estrategia es O(H), con H igual al historial de una sesión, y evita intentar invertir numéricamente una actualización bayesiana.

## Top K

`getTopK(session, K)` valida `1 <= K <= N`, devuelve exactamente K ids y ordena por `mu` descendente; los empates usan `photoId` ascendente. En la fase 3, la pertenencia final se conectará a `topKProbability` Monte Carlo como exige el brief. Hasta entonces, este Top K es la estimación determinista provisional del motor, no una implementación silenciosa de estabilidad.

K=1 y K=N están definidos. Para K=N no existe frontera de pertenencia; el selector adaptativo sigue obteniendo evidencia para el orden, mientras la futura fase de confianza medirá estabilidad interna.

## Estabilidad Monte Carlo y detención

`MonteCarloTopKConfidenceEstimator` toma cada posterior `N(mu, sigma)`, genera 1.000 muestras y ordena las fotos de cada muestra. No importa React Native ni usa aleatoriedad global: recibe `RandomSource`, y `createSeededRandom` permite fixtures y tests reproducibles.

- `inclusionProbabilities[photoId]` es la frecuencia de inclusión simulada.
- `membershipStability` es la frecuencia de que el conjunto Top K actual reaparezca, sin importar su orden.
- `orderStability` es la frecuencia de que reaparezca la secuencia Top K completa.
- `primaryStability` es pertenencia salvo en `K=N`, donde toda foto pertenece de forma trivial y se usa orden.

El criterio exige una comparación informativa por foto, ocho decisiones
informativas como mínimo, `expectedTopKOverlap` de entrada 0,90/salida 0,84 y
pertenencia sin cambios durante tres decisiones informativas. El orden interno
no bloquea la finalización. Para evitar parpadeos se conserva histéresis.

El presupuesto es dinámico: checkpoint en `max(8, 2N)`, revisión cada
`ceil(0,5N)` y límite de seguridad en
`max(checkpoint + extensionBlock, 4N)`. El checkpoint no bloquea comparaciones.
Al límite, una resolución humana muestra todas las fotos, preselecciona el Top K
estimado y exige exactamente K. `ManualTopKResolution` conserva esa decisión
separada de ratings, historial y confianza.

Para el piloto, `earlyReviewDecisions = 20` habilita además una revisión
voluntaria cuando la cobertura está completa. `canReviewSelection` expresa la
disponibilidad de revisión; `requiresManualResolution` conserva la obligación
por límite. Confirmar no cambia la confianza ni los ratings. La resolución
guarda `user-confirmation` o `hard-limit` según su origen. El benchmark automático
continúa hasta estabilidad o límite: no simula la selección humana a las 20.

En 720 sesiones sintéticas, la política `2N→4N` elevó el overlap automático de
78,0% a 84,0% y el recall de favoritas de 87,8% a 93,1% frente al corte rígido
`2N`. En el holdout obtuvo 84,2%/92,5%. La resolución humana se activó en 65,4%
de las sesiones; esa tasa confirma que todavía hace falta calibración con
personas antes de cerrar la Fase 3.1.

## Selección de pares

El selector enumera pares no ordenados y elige su orientación por separado.

### Etapa A: cobertura

Mientras alguna foto tenga menos de 2 resultados informativos (`winner`, `loser` o `draw`), solo considera pares que incluyan una foto con déficit. La puntuación suma:

```text
10 * déficit total
+ 4 si ambas fotos necesitan cobertura
+ 3 si el par nunca apareció
- 2 * apariciones previas del par
```

Un `skip` no satisface cobertura porque no aporta información al posterior, aunque sí participa en cooldown y balance de lado.

### Etapa B: adaptación

Después de cobertura, cada par recibe una prioridad explícita:

```text
2 * incertidumbre normalizada
+ 3 * cercanía de mu
+ 6 * cercanía conjunta a la frontera K/K+1
+ 4 si el par cruza la frontera
+ 1 * baja exposición
+ 3 si nunca apareció
- 2 * apariciones previas
```

La incertidumbre se normaliza por el `sigma` máximo de la sesión. La cercanía de rating disminuye con `abs(muA - muB)`. La frontera solo existe si K < N, y favorece especialmente el enfrentamiento entre las posiciones K y K+1.

Antes de puntuar se prefieren pares fuera de estos cooldowns cuando existe una alternativa:

- 3 decisiones posteriores a un `skip` del mismo par;
- 2 decisiones posteriores a cualquier aparición del mismo par.

Si no existe alternativa —por ejemplo, una sesión de dos fotos— el par vuelve a estar disponible para que el ranking pueda continuar.

## Lados y determinismo

Para el par ganador, se simulan ambas orientaciones y se elige la que minimiza la suma de desbalances absolutos izquierda/derecha de sus dos fotos. Un empate de orientación coloca primero el id lexicográficamente menor. Los empates de prioridad comparan los dos ids canónicos en orden ascendente. No hay aleatoriedad oculta.

## Cobertura técnica

Los tests de dominio cubren ganador/perdedor, empate simétrico y asimétrico, skip, 300 actualizaciones sin NaN/Infinity, historial inmutable, undo, reconstrucción, K=1, K=N, sesiones pequeñas, cobertura, repeticiones, incertidumbre, frontera, cooldown, equilibrio de lados y desempates deterministas.
