# Ranking algorithms

Las fases 2 y 3 implementan ranking probabilístico, historial, `undo`, Top K provisional, selección adaptativa, confianza Monte Carlo y criterio de detención como TypeScript puro. Los módulos de dominio no importan React Native. La fase 4 añade ONNX únicamente detrás de `ImageEmbeddingEngine`; clustering y carrusel permanecen fuera de alcance.

## Límites y contratos

- `src/domain/rating`: tipos, interfaz `RatingEngine`, sesión por eventos, reconstrucción y Top K.
- `src/infrastructure/rating`: único adaptador que importa `ts-trueskill`.
- `src/domain/pair-selection`: interfaz `PairSelectionEngine` e implementación adaptativa.
- `src/domain/confidence`: estimador Monte Carlo, RNG inyectable y recomendación de detención.
- `src/domain/ranking-config.ts`: parámetros de rating, selector, confianza e histéresis.

La UI futura consumirá estos contratos; no conocerá `Rating`, `TrueSkill` ni funciones de la dependencia.

## Compatibilidad de `ts-trueskill`

Se adoptó `ts-trueskill` 5.0.1 exacto tras comprobar que publica tipos, ESM ES2020 y admite el runtime Node 22 del proyecto. Se prefirió 5.0.1 sobre 5.1.0 porque esta última instala una rama de `mathjs` afectada por avisos de seguridad; 5.0.1 usa `mathjs` 12.4.3. `uuid` se fuerza a 11.1.1 —la misma major adoptada por `ts-trueskill` 5.1— para incluir su corrección de seguridad. La prueba de ejecución 1-vs-1 produjo posteriores finitos y el adaptador se empaquetó con Metro para Web, iOS y Android.

`uuid` necesita `crypto.getRandomValues`; el adaptador carga primero `react-native-get-random-values` 2.0.0, compatible con React Native >=0.81 y con entrada no-op para Web. Jest necesita transformar `ts-trueskill`, `ts-gaussian` y `uuid` porque son ESM; la lista está declarada en `package.json` y los tests usan el adaptador real, no un mock.

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

El criterio de detención exige cobertura de dos comparaciones informativas por foto, ocho decisiones como mínimo y estabilidad durante tres decisiones consecutivas. Para evitar parpadeos, entra con pertenencia/orden de 0,86/0,70 y permanece dentro de la banda hasta bajar de 0,80/0,62. El máximo centralizado es 100 decisiones. Estos son umbrales de UX, no una promesa matemática: el usuario puede terminar provisionalmente o continuar siempre.

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
