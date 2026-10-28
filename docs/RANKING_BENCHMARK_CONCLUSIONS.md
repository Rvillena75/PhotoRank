# PhotoRank — conclusiones del benchmark de Top K y carrusel

## Revisión de validez y candidatos — 2026-08-11

La conclusión anterior de que bastaba investigar un selector con mayor valor de
información era incompleta. La auditoría posterior encontró errores de diseño
experimental y probó cuatro familias adicionales. Después de corregir el banco,
**ningún algoritmo automático satisface simultáneamente los gates de fidelidad y
el máximo `2N` bajo los perfiles actuales**. No se cambió el selector de
producción ni se cerró la Fase 3.1.

### Correcciones realizadas al benchmark

1. Los ids sintéticos estaban ordenados exactamente como el target. El desempate
   estable por id entregaba el Top K correcto antes de comparar y contaminaba la
   evaluación. Los tiers ahora usan permutaciones fijas independientes del orden
   de ids.
2. La semilla incluía `variant.id`, aunque el documento afirmaba que todos los
   candidatos usaban las mismas semillas. Ahora la semilla depende solo de
   fixture, perfil y repetición; el simulador consume siempre seis variates por
   decisión para conservar números aleatorios comunes entre ramas.
3. `top3Recall` evaluaba exclusivamente las primeras tres posiciones producidas.
   Eso convertía orden interno en gate, contra las secciones 8, 9 y 28 del brief.
   Ahora cuenta las tres favoritas objetivo en cualquier posición del Top K y
   respeta la capacidad del tier que cruza la frontera.
4. Faltaba el control `selector actual + cobertura 1 + stop dinámico`: se
   cambiaban selector, pesos, parada y presupuesto simultáneamente. La variante
   `current-selector-dynamic-90` aísla ese efecto.
5. Se añadió `synthetic-holdout-25`; `synthetic-20` y `synthetic-30` permanecen
   como fixtures de ajuste. El CLI permite filtrar fixtures, perfiles y variantes
   sin editar código.

Estas correcciones invalidan la comparación numérica directa con la tabla
histórica que aparece más abajo. Esa tabla se conserva como registro de la
primera corrida, no como evidencia vigente para elegir producción.

### Candidatos investigados

- selector actual con presupuesto dinámico y sin cambiar pesos;
- retador heurístico de frontera;
- look-ahead de una decisión que minimiza entropía esperada de pertenencia;
- Top-Two Thompson sobre desacuerdos de membresía del posterior;
- dos o tres evidencias balanceadas por foto antes de concentrarse en frontera;
- posterior Bradley–Terry MAP recalculado sobre todo el grafo, independiente del
  orden de llegada.

Las implementaciones candidatas viven detrás de contratos de dominio y solo se
usan desde variantes del benchmark. Ninguna está conectada a `App.tsx`.

### Resultado comparable con 20 repeticiones

Corridas de ajuste: `synthetic-20` y `synthetic-30`, cuatro perfiles, 200
muestras Monte Carlo por decisión y 20 repeticiones por combinación. Los
subconjuntos se ejecutaron con seeds comunes mediante
`PHOTORANK_BENCHMARK_VARIANTS`.

| Variante | Overlap tier | Recall favoritas | Mediana decisiones/N | P90 decisiones/N |
|---|---:|---:|---:|---:|
| `current-one-coverage` (máximo 100) | 84,6% | 94,0% | 3,33 | 5,00 |
| `current-selector-dynamic-90` | 77,1% | 87,7% | 2,00 | 2,00 |
| `frontier-expected-overlap-90` | 77,0% | 88,3% | 2,00 | 2,00 |
| `top-two-thompson-90` | 72,6% | 86,9% | 2,00 | 2,00 |
| `balanced-evidence-2-frontier-90` | 75,9% | 87,3% | 2,00 | 2,00 |
| `balanced-evidence-3-frontier-90` | 72,0% | 84,2% | 2,00 | 2,00 |
| `bradley-terry-adaptive-90` | 76,5% | no comparable antes de corregir recall | 2,00 | 2,00 |
| `bradley-terry-frontier-90` | 77,2% | no comparable antes de corregir recall | 2,00 | 2,00 |

La corrida final conservada en `local-data/ranking/benchmark/latest.json` usa
20 repeticiones, 200 muestras y los tres fixtures, incluido el holdout (720
sesiones). Compara el flujo aprobado contra sus dos controles:

| Variante | Overlap tier | Recall favoritas | Shortlist K+3 | Mediana decisiones/N | P90 decisiones/N |
|---|---:|---:|---:|---:|---:|
| `current-one-coverage` | 84,5% | 93,5% | 91,8% | 3,33 | 5,00 |
| `current-selector-dynamic-90` | 78,0% | 87,8% | 84,1% | 2,00 | 2,00 |
| `production-checkpoint-2n-hard-4n` | 84,0% | 93,1% | 91,3% | 4,00 | 4,00 |

En el holdout de 25 fotos, el flujo aprobado alcanza 84,2% de overlap y 92,5%
de recall de favoritas, frente a 79,7%/87,9% del corte rígido `2N`. Iguala el
baseline de 100 decisiones sin permitir sesiones por encima de `4N`.

Estas métricas describen el resultado automático previo al fallback. El flujo
aprobado activa resolución humana en 65,4% de las simulaciones porque el
estimador no alcanza el threshold antes del límite. El simulador no puede medir
la corrección de una selección humana directa sin usar el target como oráculo;
por eso el efecto final se valida con sesiones humanas, mientras los tests
comprueban que se muestran todas las fotos y se confirman exactamente K.

La variante aislada y el retador de frontera son equivalentes dentro de la
resolución de esta corrida. Las alternativas más complejas no mejoran la
frontera de Pareto; por tanto, no hay evidencia para sustituir TrueSkill ni el
selector actual en producción.

### Por qué los gates no son alcanzables tal como están agregados

En el perfil `habitual`, una comparación entre tiers vecinos combina ruido
logístico, draw, `skip` y 10% de contradicción adicional. En `ambiguous`, la
contradicción sube a 16%, además de mayor draw, skip y cambio al repetir. Con
`2N` decisiones hay como máximo cuatro apariciones promedio por foto antes de
descontar skips. Esa evidencia no permite exigir a la vez 90% de overlap, 95%
de recall y 95% de sesiones con al menos cuatro aciertos.

La corrida de 100 decisiones lo confirma: `current-one-coverage` obtiene por
perfil un overlap de 100% (`deterministic`), 94% (`consistent`), 79,5%
(`habitual`) y 65% (`ambiguous`). El recall corregido de favoritas es 100%,
99,2%, 95% y 81,7%, respectivamente. El caso muy ambiguo representa un usuario
sin señal estable suficiente y no debe mezclarse con el camino normal como si
fuera recuperable automáticamente con el mismo contrato.

Una shortlist de `K+3` al límite `2N` tampoco resuelve el problema: contiene en
promedio 83,5% del Top K objetivo; por perfil, 100%, 89,5%, 79% y 65,5%. La
resolución de una sola plaza prevista en el brief no puede corregir sesiones con
dos o más ausencias.

### Decisión técnica aprobada e implementada

No se promovió ninguno de los selectores experimentales. El usuario aprobó una
salida híbrida basada en el selector actual:

1. `2N` es un checkpoint que permite finalizar o continuar;
2. la extensión revisa estabilidad cada `0,5N`;
3. `4N` es el límite de seguridad;
4. si persiste ambigüedad, el usuario confirma exactamente K entre todas sus
   fotos y esa resolución se guarda separada del posterior;
5. `ambiguous` se reporta como stress/fallback y no se mezcla silenciosamente
   con el camino normal para declarar fidelidad automática.

El selector actual con una cobertura continúa en producción; los motores
experimentales permanecen solo como variantes del benchmark. La calibración
humana y el cierre de los nuevos gates por perfil siguen pendientes, por lo que
la Fase 3.1 aún no se considera terminada.

**Fecha de referencia:** 2026-08-11  
**Estado:** benchmark implementado y ejecutado; ningún algoritmo candidato está
calibrado ni aprobado para producción.

Este documento es el punto de entrada para el siguiente agente que investigue y
desarrolle el algoritmo de ranking. Debe leerse junto con `brief.md`,
`AGENTS.md`, el código de `src/domain/` y el reporte JSON reproducible:
`local-data/ranking/benchmark/latest.json`.

## Resumen ejecutivo

Se implementó un banco de pruebas reproducible que genera sesiones completas
sin cargar fotos reales. Usa los mismos motores de producción para TrueSkill,
selección de pares y Monte Carlo, y simula usuarios con distintos niveles de
ruido.

La corrida de referencia usó 320 sesiones:

- 2 fixtures sintéticos: `N = 20` y `N = 30`;
- `K = 5`;
- 4 perfiles de usuario;
- 5 variantes del selector/parada;
- 8 repeticiones por combinación;
- 500 muestras Monte Carlo por decisión.

Resultado principal: ninguna variante supera simultáneamente los gates iniciales
del brief. La variante con una comparación de cobertura por foto es la mejor en
fidelidad promedio, pero todavía consume demasiadas decisiones. Las variantes
de frontera reducen el presupuesto a aproximadamente `2 * N`, pero pierden
demasiada precisión.

Esto significa que el benchmark está cumpliendo su propósito: hay evidencia de
que no basta con cambiar el threshold o reducir la cobertura; hace falta
investigar una estrategia de selección de pares con mejor valor de información
para la pertenencia al Top K.

## Qué existe actualmente en el proyecto

Está implementado:

- `RatingEngine` real basado en `ts-trueskill`;
- sesión inmutable, historial, `draw`, `skip`, `undo` y reconstrucción;
- `AdaptivePairSelectionEngine` configurable;
- estimador Monte Carlo con RNG reproducible;
- flujo de UI Top K y pipeline visual local.

Todavía no está implementado:

- `PhotoGroupingEngine` de producción;
- revisión de grupos;
- `CarouselRecommendationEngine`;
- MMR de producción;
- calibración con preferencias y tiempos de personas reales.

La Fase 3.1 continúa abierta. No se debe marcar como terminada basándose solo
en este benchmark.

## Cómo reproducirlo

Desde la raíz del repositorio:

```bash
npm run benchmark:ranking
```

El comando escribe el reporte reproducible en:

```text
local-data/ranking/benchmark/latest.json
```

Ese directorio está ignorado por Git. Para modificar el tamaño de la corrida:

```bash
PHOTORANK_BENCHMARK_SESSIONS=20 PHOTORANK_BENCHMARK_SAMPLES=1000 npm run benchmark:ranking
```

La semilla se deriva de fixture, perfil, variante y repetición. La misma
configuración debe producir las mismas decisiones, ratings y métricas.

Código relevante:

- `tools/ranking-benchmark/fixtures.ts`: fixtures, tiers y grupos;
- `tools/ranking-benchmark/human-simulator.ts`: perfiles de usuario;
- `tools/ranking-benchmark/runner.ts`: ejecución, parada, métricas y agregación;
- `tools/ranking-benchmark/carousel.ts`: referencia de diversidad por grupos;
- `tools/ranking-benchmark/README.md`: instrucciones resumidas.

## Datos sintéticos

No se usan imágenes, URI, embeddings ni archivos personales. Los ids tienen
formas como `synthetic-20-photo-01`.

| Fixture | Fotos | K | Tiers | Grupos |
|---|---:|---:|---:|---:|
| `synthetic-20` | 20 | 5 | 9 | 8 |
| `synthetic-30` | 30 | 5 | 10 | 10 |

Los tiers están ordenados de mejor a peor. Fotos dentro del mismo tier son
equivalentes para la evaluación. Por eso se reportan dos métricas distintas:

- `topKOverlap`: coincidencia con el conjunto canónico de ids;
- `tierAwareTopKOverlap`: acepta cualquier integrante equivalente del tier que
  cruza la frontera de K y es la métrica principal.

Los grupos sintéticos se usan solo para evaluar diversidad. No representan aún
la salida de MobileNet, complete-linkage ni una revisión humana real.

## Perfiles de usuario simulados

| Perfil | Comportamiento | Tiempo base hipotético |
|---|---|---:|
| `deterministic` | siempre prefiere el tier superior; empate dentro del tier | 2,2 s |
| `consistent` | ruido bajo, algunos draws y contradicciones | 3,1 s |
| `habitual` | ruido medio, cambios al repetir y algunos skips | 4,1 s |
| `ambiguous` | mucho ruido, más draws, skips y contradicciones | 5,2 s |

El simulador también modela sesgo hacia la izquierda y contradicción al repetir
un par. Los tiempos son hipótesis configurables; no son mediciones humanas y no
deben convertirse en promesas de UX.

## Variantes comparadas

| Variante | Cobertura | Parada | Presupuesto |
|---|---:|---|---:|
| `current-baseline` | 2 resultados informativos/foto | membership/order actuales | 100 decisiones |
| `current-one-coverage` | 1 resultado informativo/foto | membership/order actuales | 100 decisiones |
| `frontier-expected-overlap-90` | 1 resultado/foto | `expectedTopKOverlap >= 0,90` | `max(8, 2N)` |
| `frontier-expected-overlap-85` | 1 resultado/foto | `expectedTopKOverlap >= 0,85` | `max(8, 2N)` |
| `frontier-expected-overlap-95` | 1 resultado/foto | `expectedTopKOverlap >= 0,95` | `max(8, 2N)` |

Las variantes de frontera usan el mismo `AdaptivePairSelectionEngine` con pesos
más agresivos hacia incertidumbre, proximidad y cruce K/K+1. No son todavía un
nuevo algoritmo validado.

## Métricas

El runner registra por sesión y agrega por variante y perfil:

- decisiones presentadas, incluyendo `skip`;
- comparaciones informativas;
- media, mediana y p90 de decisiones;
- decisiones normalizadas por `N`;
- tiempo de interacción hipotético;
- solapamiento canónico y tolerante a tiers;
- recall de las primeras `min(3, K)` fotos;
- orden interno tolerante a tiers;
- frecuencia de Top K exacto;
- `expectedTopKOverlap` declarado por Monte Carlo;
- error absoluto y sesgo de calibración;
- draws, skips, contradicciones y repeticiones;
- frecuencia de llegada al máximo;
- frecuencia de resolución manual de frontera;
- redundancia y cobertura de grupos para las dos políticas de carrusel.

`expectedTopKOverlap` se calcula como la fracción esperada de fotos del Top K
actual que reaparece en una muestra posterior. No equivale a que reaparezca el
conjunto completo ni el orden exacto.

## Resultados agregados de la corrida de referencia

| Variante | Overlap tier | Recall@3 | Orden tier | Mediana decisiones/N | P90 decisiones/N | Mediana tiempo | Overlap declarado | Error abs. | Manual | Máximo |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `current-baseline` | 74,1% | 75,0% | 73,9% | 3,33 | 5,00 | 320,6 s | 75,4% | 12,8% | 89,1% | 100% |
| `current-one-coverage` | 84,7% | 76,0% | 71,1% | 3,33 | 5,00 | 315,7 s | 77,3% | 11,9% | 65,6% | 100% |
| `frontier-expected-overlap-90` | 63,8% | 50,5% | 57,5% | 2,00 | 2,00 | 166,9 s | 73,0% | 12,3% | 60,9% | 100% |
| `frontier-expected-overlap-85` | 65,0% | 49,0% | 55,5% | 2,00 | 2,00 | 172,8 s | 72,9% | 13,3% | 64,1% | 76,6% |
| `frontier-expected-overlap-95` | 60,6% | 45,8% | 56,3% | 2,00 | 2,00 | 166,3 s | 72,8% | 14,4% | 65,6% | 100% |

Lectura de la tabla:

1. `current-one-coverage` es el mejor compromiso medido de fidelidad, pero
   84,7% está por debajo del gate inicial de 90% y su p90 es cinco decisiones
   por foto.
2. Las variantes de frontera son aproximadamente 1,5–2 veces más rápidas en
   decisiones, pero su overlap y recall caen sustancialmente.
3. El threshold 0,85 no resuelve el problema: termina antes en algunas sesiones,
   pero no recupera fidelidad.
4. Ninguna variante supera todos los gates; no hay ganador que congelar.

## Resultado por perfil

Cada celda muestra `overlap tier / recall@3`.

| Variante | Determinista | Consistente | Habitual | Ambiguo |
|---|---:|---:|---:|---:|
| `current-baseline` | 0,800 / 1,000 | 0,863 / 0,729 | 0,713 / 0,687 | 0,587 / 0,583 |
| `current-one-coverage` | 1,000 / 0,833 | 0,950 / 0,875 | 0,775 / 0,687 | 0,663 / 0,646 |
| `frontier-expected-overlap-90` | 0,800 / 0,333 | 0,725 / 0,625 | 0,588 / 0,583 | 0,438 / 0,479 |
| `frontier-expected-overlap-85` | 0,800 / 0,333 | 0,750 / 0,646 | 0,637 / 0,563 | 0,413 / 0,417 |
| `frontier-expected-overlap-95` | 0,800 / 0,333 | 0,738 / 0,604 | 0,513 / 0,500 | 0,375 / 0,396 |

El perfil ambiguo es el caso crítico. La variante de frontera llega al límite
con poco conocimiento útil, aunque presente menos pares. Esto indica que el
algoritmo debe valorar la información de una comparación, no solo reducir el
número de comparaciones.

## Calibración de estabilidad

El error de calibración no es uniforme por perfil:

- `current-baseline` tiende a sobreestimar ligeramente la fidelidad en perfiles
  ambiguos y a quedarse sin resolver en el máximo;
- `current-one-coverage` queda subconfiado en promedio: el overlap declarado
  (`77,3%`) es menor que el overlap empírico (`84,7%`), pero la señal aún no
  permite parar con precisión suficiente;
- las variantes de frontera declaran aproximadamente `73%` de overlap mientras
  su fidelidad empírica es mucho menor, señal de sobreconfianza en los casos
  difíciles.

La calibración debe analizarse por bins de estabilidad y perfil, no solo por un
promedio global.

## Resultado del carrusel sintético

La política que usa el Top K directamente produce redundancia de grupo con mucha
frecuencia:

- `current-baseline` y `current-one-coverage`: duplicados de grupo en 93,8% de
  las sesiones;
- frontera con threshold 0,90/0,85: 78,1%;
- frontera con threshold 0,95: 67,2%.

La referencia `group-diverse-reference` cumple una foto por grupo y el tamaño
esperado en 100% de las sesiones porque está construida para comprobar esas
invariantes. Su recall de grupos queda limitado por la calidad del ranking
previo, aproximadamente entre 79% y 87% según la variante.

Conclusión: el carrusel no debe tomar el Top K como lista final. Necesita todas
las fotos, grupos confirmados, una representante por grupo y después MMR. Sin
embargo, estos resultados todavía no calibran pesos MMR porque el motor real de
grupos y carrusel no existe.

## Gates iniciales y estado

Los gates del brief son hipótesis de trabajo:

- overlap medio `>= 0,90`;
- al menos `K-1` fotos correctas en `>= 95%` de sesiones;
- recall de las 3 favoritas `>= 0,95`;
- mediana `<= 1,25N`;
- p90 `<= 1,75N`;
- ninguna sesión automática supera `max(8, 2N)`.

En la corrida de referencia ningún candidato pasa todos los gates. El único
gate técnico común que sí se cumple es no superar el máximo configurado.

No convertir estos gates en una función de puntuación única: la selección debe
compararse mediante una frontera de Pareto entre fidelidad, recall y esfuerzo.

## Qué debe investigar el siguiente agente

El siguiente agente debe tratar este documento y el JSON como evidencia de
calibración, no como una orden de cambiar parámetros a ciegas.

### 1. Verificar la implementación actual

Leer completamente `AGENTS.md`, `brief.md` y:

- `src/domain/pair-selection/adaptive-pair-selection-engine.ts`;
- `src/domain/confidence/monte-carlo-top-k-confidence-estimator.ts`;
- `src/domain/confidence/stop-recommendation.ts`;
- `tools/ranking-benchmark/runner.ts`.

Confirmar que el benchmark usa los motores de producción y que no hay una copia
divergente del algoritmo dentro del simulador.

### 2. Formular candidatos de selección de pares

Investigar y comparar, como mínimo:

- cobertura inicial de una comparación informativa por foto;
- exploración de fotos con baja exposición;
- candidatos explícitos alrededor de la frontera K/K+1;
- utilidad esperada de una comparación para cambiar la pertenencia al Top K;
- reducción de comparaciones repetidas que ya no aportan información;
- manejo de draws, skips y contradicciones sin tratar una derrota como
  eliminación;
- comportamiento para `K = 1`, `K = N`, pocos elementos y empates de tier.

No asumir que subir `frontierWeight` es un algoritmo nuevo. Debe explicarse qué
incertidumbre reduce cada par y medirse el efecto.

### 3. Separar pertenencia, orden y parada

La pertenencia al conjunto Top K es la prioridad. El orden interno no debe
bloquear una decisión útil. Evaluar si la parada debe usar:

- `expectedTopKOverlap`;
- probabilidad de inclusión de las candidatas K y K+1;
- estabilidad de pertenencia durante decisiones informativas;
- un límite dinámico `max(8, 2N)`;
- resolución manual explícita cuando persiste una frontera ambigua.

La nueva regla debe calibrarse contra fidelidad empírica y no contra un fixture
particular.

### 4. Mejorar la evaluación antes de congelar

Antes de elegir una variante:

1. ampliar el benchmark a más repeticiones, idealmente 20 o más por escenario;
2. añadir al menos un fixture sintético de `N = 25`;
3. mantener fixtures de ajuste separados de un holdout;
4. usar las mismas semillas para todos los candidatos;
5. inspeccionar resultados por perfil, fixture y bin de estabilidad;
6. conservar la comparación Pareto y evitar un score opaco;
7. agregar pruebas dirigidas para cada bug o regresión encontrada.

### 5. Calibrar con personas reales

Los perfiles actuales son útiles para comparar algoritmos, pero no modelan
universalmente el gusto humano. La siguiente etapa debe permitir sesiones
locales con ids o nombres de archivo, sin subir fotos ni resultados, y registrar
solo lo necesario:

- decisión y par mostrado;
- tiempo de decisión;
- draw y skip;
- repeticiones con lados invertidos;
- consistencia intra-sesión;
- comparación de distancia cercana, media y lejana.

Usar dos álbumes para ajustar y uno como holdout cuando haya datos suficientes.
No usar el holdout para elegir pesos.

### 6. Solo después implementar grupos y carrusel

Cuando el ranking tenga una configuración candidata defendible:

- implementar similitud y matriz técnica;
- implementar complete-linkage;
- validar invariantes de grupos;
- añadir revisión humana;
- implementar MMR con una representante por grupo;
- extender este benchmark para evaluar recall de grupos, redundancia, tamaño,
  unicidad de grupo y calidad del orden del carrusel.

No declarar calibrado el carrusel usando únicamente el benchmark actual: la
política de diversidad existente es una referencia de contrato, no el MMR de
producción.

## Decisión recomendada ahora

No congelar ninguna variante. Usar `current-one-coverage` como baseline de
fidelidad para futuras comparaciones y mantener `frontier-expected-overlap-90`
como baseline de bajo esfuerzo, ambos claramente marcados como no aprobados.

La siguiente implementación debe intentar mejorar la frontera entre esos dos
puntos y volver a ejecutar el mismo benchmark antes de tocar la UI o avanzar a
MMR.

## Validación ejecutada

En esta versión pasaron:

```text
npm run typecheck
npm run lint
npm test                 # 40 tests pasando
npm run benchmark:ranking
```

El benchmark terminó sin sesiones que excedieran su máximo configurado, pero
los gates de producto siguen sin cumplirse.
