# Benchmark sintético de PhotoRank

Para calcular presupuestos según N y K, consulta
`docs/COMPARISON_BUDGET.md`. El estudio de presupuestos y su resumen se ejecutan
con `run-comparison-budget-study.ts` y `summarize-comparison-budget-study.ts`;
sus resultados se guardan aparte del benchmark histórico. No modifican el
presupuesto de la app.

La variante `production-checkpoint-2n-hard-4n` usa directamente
`evaluateStopRecommendation`, igual que la app, y reporta su activación de
resolución manual. `legacy-membership` usa la parada histórica aislada en
`legacy-stop.ts`. Los retadores `expected-overlap` conservan su política
experimental independiente; no equivalen al flujo activo.

Los reportes anteriores a esta corrección no se comparan directamente con los
nuevos. Véase `docs/RANKING_SPEED_REVIEW.md`. Los gates agregados del formato
heredado son hipótesis históricas, no criterios de cierre del MVP actual.

Este directorio contiene un runner local para calibrar Top K antes de cerrar las
fases de agrupamiento y carrusel. No abre archivos de imagen: cada fixture
genera ids como `synthetic-20-photo-01`, tiers ordenados de preferencia y grupos
de similitud declarados.

## Ejecutar

Desde la raíz del proyecto:

```bash
npm run benchmark:ranking
```

El comando usa ocho repeticiones por combinación de fixture, perfil y variante,
con 500 muestras Monte Carlo por decisión. El resultado reproducible se guarda
en `local-data/ranking/benchmark/latest.json`, fuera de Git.

Para una exploración rápida o una corrida de calibración más grande:

```bash
PHOTORANK_BENCHMARK_SESSIONS=2 PHOTORANK_BENCHMARK_SAMPLES=200 npm run benchmark:ranking
PHOTORANK_BENCHMARK_SESSIONS=20 PHOTORANK_BENCHMARK_SAMPLES=1000 npm run benchmark:ranking
```

También se puede filtrar una corrida de investigación sin editar código:

```bash
PHOTORANK_BENCHMARK_FIXTURES=synthetic-20,synthetic-30 \
PHOTORANK_BENCHMARK_PROFILES=deterministic,consistent,habitual \
PHOTORANK_BENCHMARK_VARIANTS=current-one-coverage,current-selector-dynamic-90 \
npm run benchmark:ranking
```

`synthetic-20` y `synthetic-30` son fixtures de ajuste;
`synthetic-holdout-25` queda reservado como holdout. Los ids no codifican el
orden objetivo.

## Qué representa una sesión

Cada perfil recibe los mismos pares que produciría el selector real y responde
con una logística sobre el tier de cada foto. El perfil puede introducir draw,
skip, sesgo hacia la izquierda, contradicciones y cambios al repetir un par. La
semilla se deriva de fixture, perfil y repetición, por lo que repetir
la misma configuración reproduce las decisiones.

La verdad de evaluación usa tiers, no un orden absoluto. Un resultado obtiene
crédito si conserva una foto de un tier equivalente en la frontera de K. Se
reportan por separado solapamiento canónico, solapamiento tolerante a tiers,
recall de las primeras tres fotos, orden tolerante, calibración de
`expectedTopKOverlap`, decisiones y tiempo de interacción modelado.

El tiempo modelado es una hipótesis por perfil. No es evidencia de cuánto tarda
una persona real; esa parte debe sustituirse por mediciones de sesiones humanas.

## Carrusel

`top-k` trata el Top K como carrusel y permite medir redundancia. La política
`group-diverse-reference` selecciona una representante por grupo usando el
ranking completo. Es una referencia de contrato para medir cobertura y la
invariante de una foto por grupo; no es todavía el `CarouselRecommendationEngine`
ni implementa MMR. La calibración de pesos MMR debe comenzar cuando existan los
grupos confirmados y el motor de producción de la Fase 6.
