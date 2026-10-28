# PhotoRank — Product and Engineering Specification

Actúa como un Senior Software Engineer especializado en React Native, Expo, TypeScript, UX móvil, algoritmos probabilísticos de ranking, procesamiento local de imágenes y testing.

El objetivo es construir una aplicación completa, funcional y pulida que ayude a una persona a:

1. encontrar sus fotos favoritas mediante comparaciones por pares;
2. convertir ese resultado en un carrusel variado, evitando fotos visualmente redundantes.

El alcance activo de la aplicación es:

* Web;
* Android.

iOS continúa como plataforma planificada, pero su desarrollo, firma, compilación y validación están pausados hasta que el usuario indique expresamente que puede retomarlos. La pausa de iOS no bloquea las fases activas ni la Definition of Done actual. Se deben conservar la configuración, los adaptadores y el código compartido ya compatibles con iOS, sin afirmar que la plataforma funciona mientras no esté validada.

Usar una única base de producto con Expo + React Native + TypeScript. Se permiten adaptadores específicos por plataforma únicamente donde el procesamiento de imágenes o el runtime de inferencia lo requieran. Durante la pausa no dedicar trabajo a cuentas de Apple, certificados, provisioning, CocoaPods, Xcode, simuladores, dispositivos ni builds de iOS.

Antes de modificar código:

1. inspeccionar completamente el repositorio actual;
2. leer cualquier `AGENTS.md`, README, configuración o código existente;
3. no destruir trabajo existente que sea útil;
4. si el repositorio está vacío, crear correctamente el proyecto;
5. crear o actualizar un `AGENTS.md` breve con arquitectura, comandos de validación, convenciones y decisiones importantes;
6. crear documentación mínima pero suficiente en `docs/`:

   * `PRODUCT_SPEC.md`;
   * `ARCHITECTURE.md`;
   * `ALGORITHM.md`;
   * `IMAGE_SIMILARITY.md`;

7. mantener documentación y código sincronizados;
8. no detenerse después del scaffolding: implementar una aplicación funcional end-to-end;
9. no declarar la tarea terminada sin ejecutar typecheck, lint y tests técnicos relevantes;
10. si una dependencia resulta incompatible con Expo, Web o Android, usar la alternativa más simple y robusta que mantenga el comportamiento descrito aquí, documentar la decisión y continuar; evitar romper manifiestamente la ruta iOS preservada, pero no exigir su validación mientras esté pausada.

---

# 0. ESTADO DE IMPLEMENTACIÓN

Este estado evita repetir trabajo terminado y debe actualizarse al cerrar cada
fase. Un check significa código implementado y validado en el alcance indicado;
no implica que la aplicación completa esté terminada.

- [x] **Fase 1 — Fundación:** Expo + React Native + TypeScript strict,
  navegación/flujo base, tema, configuración, documentación y comandos de
  validación.
- [x] **Fase 2 — Ranking base:** `RatingEngine` con TrueSkill encapsulado,
  historial inmutable, winner/loser, draw, skip, undo, reconstrucción, Top K y
  tests de dominio.
- [x] **Fase 3 — Flujo Top K original:** selector de fotos, comparación,
  Monte Carlo, pausa, resultado provisional y compartir/exportar localmente.
- [ ] **Fase 3.1 — Ranking rápido y benchmark:** sustituir el criterio original
  demasiado estricto por el algoritmo y banco de pruebas definidos en las
  secciones 6, 8, 9 y 28. Esta es la prioridad inmediata y debe cerrarse antes
  de implementar grupos o carrusel.
- [ ] **Fase 4 — Pipeline visual, cierre Android:** exportador, ONNX, manifiesto,
  preprocesamiento, paridad PyTorch/ONNX y flujo Web ya están implementados. El
  Development Build Android compila en EAS; falta ejecutar inferencia real y
  registrar paridad en un dispositivo Android físico. iOS sigue diferido.
- [ ] **Fase 5 — Grupos:** matriz de similitud, complete-linkage y revisión
  humana obligatoria.
- [ ] **Fase 6 — Carrusel:** selección y orden MMR, edición, reemplazos, agregar
  más y exportación local.
- [ ] **Fase 7 — Endurecimiento:** accesibilidad, rendimiento, errores,
  permisos, E2E y validación integral en Web y Android.

No reimplementar las fases marcadas como terminadas salvo que una fase pendiente
requiera una modificación explícita. El trabajo activo, en orden, es: Fase 3.1,
cierre Android de Fase 4, Fase 5, Fase 6 y Fase 7.

---

# 1. VISIÓN DEL PRODUCTO

La app permite seleccionar un conjunto de fotos y descubrir cuáles le gustan más al usuario mediante comparaciones extremadamente sencillas.

La pregunta se mantiene deliberadamente abierta. La aplicación no intenta definir qué significa que una foto sea “mejor” ni pide elegir un tema o criterio previo. El usuario simplemente selecciona la fotografía que prefiere en cada enfrentamiento.

La interacción principal es:

```text
Foto A vs Foto B
→ el usuario elige A o B
```

También existen:

* **Iguales**: ambas fotos le gustan aproximadamente por igual;
* **Saltar / No sé**: no actualizar ratings y evitar repetir inmediatamente el mismo enfrentamiento;
* **Deshacer**: revertir la última decisión y restaurar el estado anterior de forma fiable.

La aplicación NO usa un torneo de eliminación simple. Una foto que pierde contra la favorita no queda eliminada. El resultado se infiere a partir del historial completo de preferencias.

Después de obtener el Top K, el usuario puede terminar o continuar hacia un carrusel recomendado. El carrusel no se construye con nuevas comparaciones por pares: se basa en el ranking ya obtenido, similitud visual automática, revisión humana de grupos y un algoritmo de diversidad.

---

# 2. FLUJO PRINCIPAL ÚNICO

La app tiene un flujo principal, no dos modos independientes:

```text
Home
→ seleccionar X fotos
→ elegir K
→ comparar fotos
→ obtener Top K
→ opcionalmente crear carrusel
→ analizar similitud localmente
→ revisar grupos sugeridos
→ generar carrusel recomendado
→ editar o agregar fotos
→ usar/exportar resultado
```

Reglas:

* siempre se completa primero el ranking individual;
* no existe una entrada directa al carrusel que evite el ranking;
* crear el carrusel es opcional;
* el tamaño objetivo del carrusel recomendado es K;
* si hay al menos K grupos confirmados, el carrusel inicial debe contener K fotos;
* solo puede contener menos de K cuando existen menos de K grupos confirmados;
* el usuario conserva siempre la decisión final;
* el sistema nunca oculta definitivamente una fotografía.

---

# 3. SETUP DE LA SESIÓN

El usuario debe poder:

* seleccionar varias fotos;
* ver cuántas seleccionó;
* elegir K;
* usar K = 5 por defecto;
* quitar fotos antes de comenzar;
* comenzar la sesión únicamente cuando la configuración sea válida.

Validaciones:

* para realizar comparaciones deben existir al menos 2 fotos;
* `1 <= K <= photoCount`;
* impedir fotos duplicadas cuando puedan identificarse con seguridad mediante asset id, URI o fingerprint de archivo;
* si una foto no puede cargarse, informarlo y permitir quitarla o reintentar;
* no mantener Base64 de las imágenes originales en el estado de la aplicación.

Antes de comenzar, mostrar una expectativa breve y no contractual sobre la duración. No prometer un número exacto de comparaciones.

---

# 4. RANKING TOP K

El objetivo es encontrar las K fotos que el usuario prefiere individualmente.

Ejemplo:

```text
30 fotos seleccionadas
K = 5
→ resultado ordenado con las 5 favoritas
```

Cada fotografía mantiene un rating probabilístico con:

* preferencia estimada;
* incertidumbre;
* historial de resultados.

Usar TrueSkill o un algoritmo probabilístico equivalente basado en distribuciones gaussianas.

La primera opción debe ser `ts-trueskill`, encapsulada detrás de una interfaz propia para evitar acoplamiento con una librería externa.

Nunca interpretar una derrota como eliminación.

---

# 5. MODELO DE RATING

Cada foto debe mantener al menos:

```ts
interface PhotoRating {
  mu: number;
  sigma: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
}
```

Mantener separados:

* `mu`: estimación media de preferencia;
* `sigma`: incertidumbre;
* `conservativeScore`: señal conservadora interna cuando corresponda;
* `topKProbability`: probabilidad aproximada de pertenecer al Top K.

Una posible medida conservadora es:

```ts
conservativeScore = mu - 3 * sigma;
```

Centralizar todos los parámetros en configuración. No dispersar constantes mágicas.

No mostrar directamente `mu`, `sigma` ni cifras técnicas. Si se presenta un puntaje, convertirlo a una escala comprensible y aclarar que es relativo a la sesión.

Para el resultado:

* pertenencia al Top K: usar la estimación probabilística de inclusión;
* orden dentro del resultado: usar la preferencia estimada, con una regla determinista para empates;
* incertidumbre: mostrarla por separado como estabilidad, no mezclarla silenciosamente con calidad.

---

# 6. SELECCIÓN ADAPTATIVA DE PARES

No elegir parejas completamente al azar.

Implementar un `PairSelectionEngine` puro y testeable.

## Etapa A — Cobertura inicial

Antes de concentrarse en las favoritas:

* intentar que todas las fotos participen;
* exigir solo 1 comparación informativa por foto;
* emparejar preferentemente dos fotos que todavía no tengan cobertura, para
  completar esta etapa en aproximadamente `ceil(N / 2)` decisiones cuando no
  existan `skip`;
* evitar enfrentamientos repetidos innecesarios;
* equilibrar cuántas veces una foto aparece a izquierda y derecha para reducir sesgo de posición.

`left`, `right` y `draw` aportan cobertura. `skip` registra que el par fue
mostrado y activa cooldown, pero no satisface cobertura porque no actualiza el
posterior.

## Etapa B — Ranking adaptativo

Después de la cobertura básica, concentrar las comparaciones en identificar la
frontera de pertenencia al Top K, no en perfeccionar prematuramente el orden
interno. En cada decisión:

1. estimar `topKProbability` de todas las fotos;
2. identificar las integrantes actuales menos seguras del Top K;
3. identificar las candidatas exteriores con mayor probabilidad de entrar;
4. priorizar un cruce de frontera cuyo resultado pueda cambiar la selección y
   cuya preferencia relativa permanezca incierta;
5. respetar cooldown por repetición y `skip`;
6. introducir exploración ocasional de fotos con poca evidencia para evitar que
   una clasificación inicial equivocada quede bloqueada.

Para K = 5, comparar #4 con #6 suele aportar más que comparar #1 con #25.

Diseñar una función explícita de prioridad que pueda combinar:

* probabilidad de inclusión;
* incertidumbre del enfrentamiento;
* impacto esperado sobre la frontera K/K+1;
* cantidad de encuentros previos;
* total de comparaciones;
* penalización por repetición;
* cooldown después de `skip`;
* exploración de baja exposición.

El benchmark de la sección 28 debe comparar el selector actual con al menos un
selector de retador de frontera. No cambiar TrueSkill ni fijar pesos nuevos por
intuición: elegir los parámetros usando la frontera observada entre fidelidad y
número de comparaciones.

No colocar esta lógica dentro de componentes de UI.

---

# 7. RESULTADOS DE COMPARACIÓN

Los resultados posibles son:

```ts
type ComparisonOutcome =
  | { type: "left" }
  | { type: "right" }
  | { type: "draw" }
  | { type: "skip" };
```

Reglas:

* `left` y `right` actualizan ambos ratings;
* `draw` comunica preferencia similar y actualiza el modelo como empate;
* con priors idénticos, un empate debe conservar simetría;
* con priors diferentes, un empate debe acercar razonablemente las estimaciones;
* `skip` no modifica ratings ni estadísticas de victoria/derrota/empate;
* `skip` sí puede registrar que esa pareja fue mostrada para aplicar cooldown;
* `undo` revierte por completo la última acción.

Mantener un historial inmutable de eventos. Para deshacer, restaurar snapshots seguros o recalcular el estado desde el historial; no intentar revertir ratings con operaciones matemáticas aproximadas.

---

# 8. ESTABILIDAD DEL TOP K

No usar solamente el número de duelos como progreso.

Estimar la estabilidad mediante Monte Carlo:

1. tomar la distribución posterior `N(mu, sigma)` de cada foto;
2. ejecutar muestras simuladas;
3. obtener el Top K de cada muestra;
4. calcular la frecuencia estimada de inclusión de cada foto;
5. calcular cuántas posiciones del Top K actual se conservan en promedio.

Mantener la simulación aislada y determinista bajo tests mediante inyección de RNG.

Usar aproximadamente 500–2000 muestras según rendimiento.

En la UI hablar de **estabilidad**, no de certeza matemática:

* resultado inicial;
* bastante estable;
* muy estable.

La métrica principal es:

```text
expectedTopKOverlap =
  sum(topKProbability[photoId] para cada foto del Top K actual) / K
```

Interpreta `0.90` como una conservación esperada de 4,5 fotos en un Top 5. No
equivale a certeza matemática ni exige que el conjunto completo reaparezca
idéntico en cada muestra.

Mantener como diagnósticos separados:

* probabilidad individual de inclusión;
* coincidencia exacta del conjunto Top K;
* estabilidad aproximada o exacta del orden interno.

La coincidencia exacta del conjunto y del orden no bloquea la finalización. Un
intercambio entre dos fotos casi equivalentes no debe convertir un resultado
útil en una sesión interminable.

Cuando `K = N`, la pertenencia es trivial: terminar la selección al completar la
cobertura y tratar cualquier refinamiento del orden como opcional.

---

# 9. CRITERIO DE DETENCIÓN

No exigir estabilidad perfecta ni un número fijo de comparaciones. Para `K < N`,
recomendar finalizar cuando se cumplan simultáneamente:

* todas las fotos tienen al menos una comparación informativa;
* `expectedTopKOverlap >= 0.90` como threshold inicial;
* el Top K no presenta cambios importantes durante 3 decisiones informativas
  consecutivas;
* se alcanzó el mínimo dinámico de evidencia definido en configuración.

El orden interno nunca es condición de detención. El threshold `0.90`, el mínimo
dinámico y los pesos del selector deben calibrarse con el benchmark; cualquier
cambio posterior se documenta y no se ajusta silenciosamente para hacer pasar
un fixture concreto.

Agregar histéresis para que el estado de estabilidad no oscile continuamente.

Centralizar thresholds y límites en configuración.

Para la prueba del MVP, ofrecer **Terminar y revisar mi Top K** a partir de
20 decisiones presentadas (incluidos `skip`), siempre que todas las fotos tengan
al menos una comparación informativa. El umbral se centraliza en configuración.
Es una opción voluntaria: no exige ni declara estabilidad automática, no detiene
los duelos y permite seguir comparando. La revisión muestra todas las fotos,
preselecciona las K recomendadas y exige confirmar exactamente K. Se registra
como `source = user-confirmation`, separada del posterior y de la resolución
obligatoria por límite (`source = hard-limit`). Con 20 fotos y K=5, esta opción
permite cerrar la selección tras 20 decisiones si la cobertura está completa.
Si al llegar a 20 aún falta cobertura, se habilita cuando se complete.

`max(8, 2 * N)` decisiones presentadas, incluidos `skip`, es el primer
**checkpoint**, no un límite rígido. Al alcanzarlo:

* si el Top K ya cumple el criterio de estabilidad, recomendar finalizar;
* si sigue ambiguo, permitir ver el resultado provisional o continuar sin perder
  el historial;
* revisar de nuevo cada `ceil(0.5 * N)` decisiones adicionales;
* explicar que las comparaciones extra se concentran en las candidatas difíciles.

Existe un límite de seguridad de `max(checkpoint + extensionBlock, 4 * N)`
decisiones presentadas. No generar más duelos automáticamente después de ese
límite.

Si al llegar al límite de seguridad el Top K continúa ambiguo, mostrar una
resolución humana ampliada con todas las fotos de la sesión. La recomendación
automática aparece preseleccionada y el usuario elige exactamente K fotos,
pudiendo reemplazar cualquiera. Esta selección final:

* pertenece al usuario;
* se registra separada del rating probabilístico;
* conserva el posterior y la estabilidad declarada sin falsificarlos;
* no se interpreta como nueva evidencia ni actualiza `mu` o `sigma`;
* bloquea la creación del carrusel hasta confirmar exactamente K fotos.

Al alcanzar estabilidad suficiente, mostrar:

```text
Tu Top K ya está bastante estable.
```

Ofrecer:

* Ver resultado;
* Seguir comparando;
* Afinar el orden de forma opcional y con presupuesto pequeño;
* Ver resultado provisional antes de alcanzar estabilidad completa.

No presentar 100% como meta. Durante la comparación priorizar estados
comprensibles: **Conociendo tus fotos**, **Definiendo las últimas candidatas** y
**Top K suficientemente estable**. Los porcentajes técnicos pueden aparecer en
diagnóstico o resultado, pero no como barra que el usuario deba completar.

El usuario puede pausar o abandonar la sesión. Reiniciar o abandonar progreso requiere confirmación.

---

# 10. RESULTADO TOP K

Mostrar una presentación satisfactoria y centrada en las fotos:

* Top K ordenado;
* posición;
* foto;
* estabilidad relativa cuando aporte valor;
* nombre de archivo u otra referencia local útil cuando esté disponible.

Permitir:

* ampliar una foto;
* deshacer y volver a comparar;
* continuar comparando para mejorar estabilidad;
* reiniciar;
* compartir/exportar localmente las fotos seleccionadas usando capacidades del sistema;
* continuar a **Crear carrusel**.

No integrar directamente Instagram en el MVP.

---

# 11. OBJETIVO DEL CARRUSEL

El carrusel recomendado debe evitar redundancia visual sin juzgar belleza ni sustituir el gusto del usuario.

Responsabilidades separadas:

* TrueSkill determina qué fotos prefiere el usuario;
* el modelo visual estima qué fotos se parecen;
* el agrupamiento organiza sugerencias de redundancia;
* el usuario valida los grupos;
* el recomendador combina preferencia y diversidad;
* el usuario edita el resultado final.

En el MVP, K cumple dos funciones: define el tamaño del ranking individual y también `targetCarouselSize`.

Cuando varias fotos del Top K pertenecen al mismo grupo, conservar una sola representante y reemplazar automáticamente las posiciones redundantes por las mejores representantes de otros grupos. Si existen al menos K grupos confirmados, el carrusel inicial debe contener K fotos.

Ejemplo:

```text
Top 5: selfie A, selfie B, selfie C, cuerpo completo, paisaje
selfie A/B/C pertenecen al mismo grupo

Carrusel recomendado:
selfie A, cuerpo completo, paisaje, espontánea, otra escena
```

El carrusel inicial solo puede ser menor que K cuando, después de la revisión humana, existen menos de K grupos. Nunca completar automáticamente el cupo con una segunda foto del mismo grupo.

Usar el nombre **Carrusel recomendado**, no afirmar que existe un “mejor carrusel” objetivo.

---

# 12. ANÁLISIS VISUAL LOCAL

El análisis comienza solamente cuando el usuario elige crear un carrusel.

Analizar las X fotos de la sesión, no solo el Top K, para poder ofrecer alternativas y recomendaciones posteriores.

El pipeline es:

```text
URI local
→ orientación normalizada
→ imagen RGB
→ resize/crop normalizado
→ tensor 224 × 224
→ MobileNetV3 Small congelado
→ features
→ AdaptiveAvgPool2d(1)
→ flatten
→ vector de 576 componentes
→ normalización L2 dentro del modelo ONNX
```

Requisitos:

* modelo empaquetado con la aplicación;
* archivo exacto: `mobilenet_v3_small_imagenet1k_v1_pooled_l2.onnx`;
* formato ONNX, opset 17;
* pesos y operaciones en `float32`;
* input estático `image`, tipo `float32`, layout NCHW y shape `[1, 3, 224, 224]`;
* output estático `embedding`, tipo `float32` y shape `[1, 576]`;
* salida L2-normalizada dentro del grafo ONNX;
* no cuantizar el modelo en el MVP;
* inferencia completamente local;
* procesar una foto a la vez;
* no cargar simultáneamente todas las imágenes full-resolution;
* ejecutar inferencia y decodificación fuera del hilo principal cuando sea posible;
* mostrar progreso, cancelación y reintento;
* no comenzar la revisión hasta que todas las fotos válidas hayan sido procesadas.

Contrato de preprocesamiento:

* respetar y normalizar orientación EXIF;
* convertir el color a sRGB y luego a tres canales RGB;
* redimensionar el lado corto a 256 conservando aspect ratio;
* usar interpolación bilinear con antialiasing;
* aplicar center crop de 224 × 224;
* convertir valores a `[0, 1]`;
* normalizar por canal con:

```ts
mean = [0.485, 0.456, 0.406]
std = [0.229, 0.224, 0.225]
```

El mismo contrato debe aplicarse y validarse en Web y Android. La implementación iOS debe conservar este contrato para retomarlo después, pero su paridad queda diferida mientras la plataforma esté pausada. Las implementaciones por plataforma pueden variar internamente, pero las plataformas activas deben producir embeddings equivalentes dentro de una tolerancia documentada.

## Modelo congelado

Usar exactamente:

```py
torchvision.models.mobilenet_v3_small(
    weights=MobileNet_V3_Small_Weights.IMAGENET1K_V1,
    width_mult=1.0,
    reduced_tail=False,
    dilated=False,
)
```

Checkpoint de origen:

```text
https://download.pytorch.org/models/mobilenet_v3_small-047dcff4.pth
SHA-256: 047dcff4addef86ea5bc2eff13c9614dc11f47ab1160d0a71a25e7db994f4e1f
```

El wrapper de exportación debe ejecutar exactamente:

```py
x = model.features(x)
x = model.avgpool(x)
x = torch.flatten(x, 1)
x = torch.nn.functional.normalize(x, p=2, dim=1, eps=1e-12)
return x
```

El embedding se extrae después de `features`, `AdaptiveAvgPool2d(1)` y `flatten`. Para la configuración estándar, `features` termina en 576 canales y el resultado es un vector de 576 componentes.

Excluir por completo `model.classifier`, incluyendo:

```text
Linear(576 → 1024)
→ Hardswish
→ Dropout
→ Linear(1024 → 1000)
```

No usar como embedding ni la salida de 1024 componentes ni los logits de 1000 clases. Cambiar pesos, punto de extracción, dimensiones, preprocesamiento, opset o cuantización constituye una nueva versión mayor del modelo y obliga a recalibrar `similarityThreshold`.

---

# 13. RUNTIME DE INFERENCIA

Usar:

* `onnxruntime-react-native` en Android y, cuando se retome la plataforma, iOS;
* `onnxruntime-web` en navegador;
* WebAssembly/CPU como baseline web;
* WebGPU únicamente como aceleración opcional con fallback automático;
* realizar el preprocesamiento en adaptadores propios por plataforma;
* no usar ONNX Runtime Extensions en el MVP.

Mientras la versión fijada `onnxruntime-react-native` 1.24.3 requiera la
corrección de compatibilidad con Gradle 9 que ya existe en la rama principal de
Microsoft, aplicarla mediante un script `postinstall` reproducible que valide
versión y fuente esperada antes de modificar `node_modules`. No mantener una
edición manual ni aceptar un parche parcial. Al actualizar la dependencia,
revisar explícitamente si el workaround puede eliminarse y repetir el
Development Build y la paridad Android.

Encapsular el runtime detrás de:

```ts
interface ImageEmbeddingEngine {
  initialize(): Promise<void>;
  embed(photo: PhotoAsset): Promise<ReadonlyArray<number>>;
  dispose(): Promise<void>;
}
```

No acoplar dominio, clustering ni UI a ONNX Runtime.

## `MODEL_MANIFEST.json`

Mantener junto al `.onnx` un archivo obligatorio llamado `MODEL_MANIFEST.json`. Es la fuente de verdad del artefacto y debe incluir:

```ts
interface ModelManifest {
  schemaVersion: 1;
  modelId: "torchvision-mobilenet-v3-small-imagenet1k-v1-pooled-576";
  modelVersion: "1.0.0";
  file: "mobilenet_v3_small_imagenet1k_v1_pooled_l2.onnx";
  sha256: string;
  source: {
    framework: "torchvision";
    architecture: "mobilenet_v3_small";
    weights: "MobileNet_V3_Small_Weights.IMAGENET1K_V1";
    checkpointUrl: "https://download.pytorch.org/models/mobilenet_v3_small-047dcff4.pth";
    checkpointSha256: "047dcff4addef86ea5bc2eff13c9614dc11f47ab1160d0a71a25e7db994f4e1f";
    widthMult: 1.0;
    reducedTail: false;
    dilated: false;
  };
  graph: {
    opset: 17;
    inputName: "image";
    inputDtype: "float32";
    inputShape: [1, 3, 224, 224];
    outputName: "embedding";
    outputDtype: "float32";
    outputShape: [1, 576];
    extractionPoint: "features.avgpool.flatten";
    l2Normalization: { p: 2; axis: 1; epsilon: 1e-12 };
    quantization: "none";
  };
  preprocessing: {
    exifOrientation: "normalize";
    colorSpace: "sRGB";
    channels: "RGB";
    resizeShortSide: 256;
    interpolation: "bilinear";
    antialias: true;
    centerCrop: [224, 224];
    valueRange: [0, 1];
    mean: [0.485, 0.456, 0.406];
    std: [0.229, 0.224, 0.225];
  };
  toolchain: {
    python: string;
    torch: string;
    torchvision: string;
    onnx: string;
    onnxruntime: string;
    exporter: "torch.onnx.export";
  };
  license: {
    code: string;
    weights: string;
    datasetTerms: string;
  };
}
```

El hash del checkpoint queda fijado por este brief. El script de exportación debe verificarlo antes de cargar los pesos, calcular el SHA-256 completo del ONNX generado y escribirlo en `sha256`; el manifiesto entregado no puede contener placeholders.

Antes de exportar, ejecutar `model.eval()`. No usar ejes dinámicos: el batch y las dimensiones espaciales quedan fijos. Las versiones de `python`, `torch`, `torchvision`, `onnx` y `onnxruntime` se fijan en el lockfile del exportador y se copian literalmente al manifiesto.

Versionar también:

* script reproducible de exportación;
* dependencias Python bloqueadas con versiones exactas;
* licencia y atribuciones verificadas;
* fixtures de referencia y embeddings esperados.

Al inicializar, la app debe comprobar que el nombre, SHA-256, input y output coinciden con el manifiesto. Si no coinciden, rechazar el modelo y mostrar el mismo estado recuperable definido para un fallo del motor visual.

La app Android debe usar Expo Development Builds porque el runtime contiene código nativo. No exigir que funcione dentro de Expo Go. Esta misma regla aplicará a iOS cuando se retome.

Si el motor visual falla o el dispositivo no puede cargarlo:

* Top K debe seguir funcionando;
* mostrar un error claro y permitir reintentar;
* no construir un carrusel mediante agrupación manual como fallback;
* no afirmar que existe una recomendación automática.

---

# 14. SIMILITUD ENTRE FOTOS

Para embeddings L2-normalizados, usar similitud coseno:

```ts
similarity(a, b) = dot(a, b)
distance(a, b) = 1 - similarity(a, b)
```

Construir una matriz simétrica de similitud para todas las fotos válidas.

Reglas:

* diagonal = 1;
* valores finitos;
* simetría dentro de tolerancia;
* no recalcular innecesariamente el mismo par;
* para el tamaño esperado de una sesión, un cálculo O(N²) es aceptable;
* mantener embeddings y matriz fuera del estado visual de React.

Usar inicialmente:

```ts
similarityThreshold = 0.85
```

Este valor es configurable y constituye un punto de partida, no una verdad universal. Ajustarlo después de pruebas reales sin cambiar la arquitectura.

---

# 15. AGRUPAMIENTO AUTOMÁTICO

Implementar `PhotoGroupingEngine` puro y testeable.

Usar clustering jerárquico aglomerativo con:

* distancia coseno precomputada;
* `complete linkage`;
* threshold configurable;
* número de grupos inferido automáticamente.

`Complete linkage` evita que una cadena de similitudes débiles cree un grupo incoherente: para unir dos grupos se considera la mayor distancia entre sus miembros.

Invariantes:

* cada foto válida pertenece exactamente a un grupo;
* ninguna foto aparece dos veces;
* los grupos no están vacíos;
* los resultados son deterministas para la misma matriz y configuración;
* una foto sin vecinas suficientemente similares forma un singleton;
* cambios manuales posteriores no alteran ratings ni embeddings.

Cada grupo tiene una representante inicial:

* elegir la foto con mejor posición individual;
* si existe empate, resolverlo mediante preferencia estimada y luego id estable;
* el usuario puede cambiarla durante la revisión.

---

# 16. REVISIÓN DE GRUPOS

La revisión es obligatoria antes de generar el carrusel.

La app debe mostrar primero los grupos con 2 o más fotos. Los singletons aparecen en una sección secundaria colapsable como “Fotos únicas”.

Cada grupo debe mostrar:

* todas sus fotos;
* la representante sugerida;
* su cantidad de fotos;
* controles simples y claros.

Permitir:

* aceptar todos los grupos con una acción principal;
* abrir un grupo;
* cambiar su representante;
* separar una foto incorrectamente agrupada, convirtiéndola en singleton;
* unir dos grupos cuando el sistema dejó fotos similares separadas;
* mover una foto de un grupo a otro;
* restaurar la propuesta automática original.

La pantalla no debe obligar a crear grupos desde cero. La ruta feliz es revisar rápidamente y aceptar.

Si no se detectaron grupos con varias fotos, informar:

```text
No encontramos fotos claramente repetidas.
Revisa las fotos únicas y continúa cuando quieras.
```

---

# 17. SELECCIÓN DEL CARRUSEL RECOMENDADO

Después de confirmar grupos:

1. tomar todos los grupos confirmados, no solo los representados en el Top K;
2. usar exactamente una representante confirmada por cada grupo como candidata;
3. fijar `targetCarouselSize = K`;
4. seleccionar y ordenar candidatas mediante el mismo proceso MMR;
5. detenerse al alcanzar `min(targetCarouselSize, confirmedGroupCount)`.

Consecuencias obligatorias:

* si `confirmedGroupCount >= K`, el carrusel inicial contiene exactamente K fotos;
* una posición redundante del Top K se reemplaza automáticamente por la candidata MMR mejor puntuada de un grupo todavía ausente;
* ninguna selección automática incluye dos fotos del mismo grupo;
* si `confirmedGroupCount < K`, el carrusel inicial contiene una foto por grupo y puede ser menor que K;
* si solo existe un grupo, mostrar una única representante e informar que no se encontró variedad suficiente;
* cuando `K = 1`, el carrusel inicial contiene una foto;
* el usuario puede superar K o agregar varias fotos del mismo grupo manualmente después.

---

# 18. SELECCIÓN Y ORDENAMIENTO CON MMR

MMR selecciona las fotos y define su orden en una única pasada voraz. No seleccionar primero un conjunto para ordenarlo después.

El conjunto de candidatas contiene una representante por cada grupo confirmado.

La primera seleccionada es la candidata con mejor posición en el ranking individual y se convierte en portada.

Para una foto en la posición `rank` dentro de las N fotos de la sesión:

```ts
normalizedPreference =
  N === 1 ? 1 : 1 - ((rank - 1) / (N - 1));
```

Para comparar la penalización de similitud con esa señal:

```ts
normalizedSimilarity(a, b) =
  clamp((cosineSimilarity(a, b) + 1) / 2, 0, 1);
```

Para cada siguiente foto:

```ts
carouselScore(candidate) =
  qualityWeight * normalizedPreference(candidate)
  - diversityWeight * max(
      normalizedSimilarity(candidate, selectedPhoto)
      for selectedPhoto in alreadySelected
    )
```

Valores iniciales:

```ts
qualityWeight = 0.7
diversityWeight = 0.3
```

Repetir hasta seleccionar `min(targetCarouselSize, confirmedGroupCount)` candidatas. El orden en que MMR las selecciona es el orden recomendado del carrusel.

Desempates, en este orden:

1. mejor posición en el ranking individual;
2. `photoId` estable ascendente.

Reglas:

* pesos centralizados y configurables;
* `qualityWeight + diversityWeight = 1`;
* comportamiento determinista;
* no volver a evaluar otras fotos del grupo durante la selección automática;
* no usar metadata temporal ni ubicación para inferir una historia en el MVP;
* no afirmar que el orden tiene significado narrativo;
* permitir al usuario reordenar libremente.

---

# 19. AGREGAR, QUITAR Y REEMPLAZAR

En el resultado del carrusel, permitir:

* ampliar fotos;
* mover izquierda/derecha;
* drag-and-drop únicamente si es fiable en todas las plataformas activas;
* quitar una foto;
* reemplazar una foto por otra de su grupo;
* agregar recomendaciones;
* abrir todas las fotos y añadir cualquiera;
* volver a revisar grupos;
* restaurar la recomendación inicial.

Orden de recomendaciones para **Agregar más**:

1. representantes de grupos aún ausentes, continuando el mismo orden MMR;
2. fotos cercanas al Top K que aporten diversidad;
3. alternativas de grupos ya representados;
4. resto de las fotos por ranking individual.

Al agregar una foto de un grupo ya representado, mostrar una advertencia discreta de posible similitud, pero no bloquear la acción.

La elección final siempre pertenece al usuario.

---

# 20. PANTALLAS

Como mínimo:

## Home

Una propuesta principal:

**Elegir mis mejores fotos**

Descripción:

```text
Compara fotos de a dos, encuentra tus favoritas y crea un carrusel variado.
```

No mostrar dos modos independientes.

## Setup

* seleccionar fotos;
* mostrar cantidad;
* elegir K;
* quitar fotos;
* validaciones;
* botón Empezar.

## Comparación

* dos fotos grandes sin recorte destructivo;
* elegir izquierda/derecha;
* Iguales;
* Saltar / No sé;
* Deshacer;
* ampliar;
* feedback visual rápido;
* estabilidad discreta;
* salir/pausar con confirmación.

## Resolución final del Top K

Puede abrirse voluntariamente a partir de 20 decisiones con cobertura completa,
o al alcanzar el límite de seguridad con pertenencia todavía ambigua:

* muestra todas las fotos ordenadas por la estimación actual;
* preselecciona el Top K automático;
* permite reemplazar cualquier integrante;
* exige exactamente K fotos para confirmar;
* en el cierre voluntario explica que el usuario puede confirmar sus favoritas
  sin esperar estabilidad; en el límite informa de la ambigüedad restante;
* no altera retroactivamente el historial, ratings ni confianza estadística;
* permite ampliar cada foto antes de decidir.

## Resultado Top K

* ranking visual;
* estabilidad comprensible;
* seguir comparando;
* aceptar el orden estimado, afinarlo opcionalmente o reordenarlo cuando la UI
  correspondiente esté disponible;
* compartir/exportar selección;
* CTA Crear carrusel.

## Analizando fotos

* explicación de que el procesamiento ocurre en el dispositivo;
* progreso real por cantidad procesada;
* cancelación;
* error y reintento.

## Revisar grupos

* grupos con varias fotos primero;
* representante visible;
* singletons colapsados;
* edición puntual;
* aceptar grupos.

## Carrusel recomendado

* secuencia ordenada;
* portada claramente marcada;
* reordenar, quitar, reemplazar y agregar;
* acceso a todas las fotos;
* compartir/exportar localmente.

## Visor de foto

* imagen completa;
* zoom y cierre accesibles;
* no permitir shortcuts de selección mientras esté abierto.

---

# 21. UX

Prioridades:

1. extremadamente simple;
2. centrada en las fotografías;
3. rápida;
4. divertida;
5. sin apariencia de herramienta estadística;
6. transparente respecto del análisis local;
7. siempre editable.

La inspiración conceptual puede ser un “Mundial de fotos”, pero nunca usar un bracket de eliminación como algoritmo.

Puede mantenerse sensación competitiva mediante:

* enfrentamientos;
* transiciones;
* progreso;
* pequeñas animaciones;
* haptics.

Crear identidad propia, moderna, limpia y mobile-first. Debe verse bien también en navegador de escritorio.

Usar:

* jerarquía clara;
* espaciado consistente;
* buen contraste;
* botones táctiles grandes;
* Safe Areas;
* estados empty/loading/error;
* labels accesibles;
* foco visible en Web;
* navegación por teclado cuando corresponda;
* soporte para reducir movimiento.

Evitar diseño genérico de demo.

---

# 22. CONTROLES WEB

Además de click/tap:

* flecha izquierda → elegir foto izquierda;
* flecha derecha → elegir foto derecha;
* espacio → saltar;
* `Z` o shortcut documentado → deshacer.

No permitir selecciones mientras exista un modal, visor o input activo.

Mostrar los shortcuts de forma discreta y permitir completar todo el flujo sin teclado.

---

# 23. PRIVACIDAD

El producto es local-first.

No subir fotografías, thumbnails, embeddings, ratings ni matriz de similitud a servidores.

No agregar:

* backend;
* autenticación;
* Supabase;
* Firebase;
* almacenamiento cloud;
* OpenAI API;
* reconocimiento facial;
* identificación de personas;
* clasificación de belleza;
* telemetría de terceros que requiera transmitir información de la sesión.

El modelo visual analiza la imagen completa únicamente para similitud general. No identifica rostros ni personas.

Embeddings y matriz de similitud:

* permanecen en memoria durante la sesión;
* no se incluyen en logs;
* no se sincronizan;
* se eliminan al finalizar o descartar la sesión;
* pueden recalcularse si el usuario vuelve a crear el carrusel.

Solicitar solo permisos necesarios. No registrar paths, EXIF ni metadata sensible innecesariamente.

El ranking y la inferencia deben funcionar sin Internet una vez que la aplicación y el modelo estén instalados o cargados.

---

# 24. ARQUITECTURA

Separar estrictamente UI, dominio e infraestructura.

Estructura sugerida:

```text
src/
  components/
  features/
    photo-picker/
    ranking/
    group-review/
    carousel/
  domain/
    rating/
    pair-selection/
    confidence/
    similarity/
    grouping/
    carousel/
  infrastructure/
    image-embedding/
      native/
      web/
    persistence/
  hooks/
  state/
  utils/
  theme/
tools/
  ranking-benchmark/
local-data/
  ranking/              # siempre ignorado por Git
```

Interfaces principales:

```ts
RatingEngine
PairSelectionEngine
TopKConfidenceEstimator
RankingBenchmarkRunner
ImageEmbeddingEngine
PhotoSimilarityEngine
PhotoGroupingEngine
CarouselRecommendationEngine
```

Requisitos:

* rating, selección de pares, confianza, clustering y recomendación deben testearse sin React Native;
* el benchmark usa los mismos motores de dominio que producción y no una copia
  divergente del algoritmo;
* ONNX Runtime solo aparece en infraestructura;
* UI consume casos de uso, no librerías matemáticas o de ML;
* estado derivado se recalcula cuando sea barato;
* no usar Redux salvo necesidad extraordinaria;
* Zustand es aceptable;
* evitar arquitectura empresarial innecesaria.

---

# 25. MODELOS DE DATOS

Definir tipos explícitos y evitar `any`.

```ts
type PhotoId = string;
type GroupId = string;

interface PhotoAsset {
  id: PhotoId;
  uri: string;
  width?: number;
  height?: number;
  filename?: string;
  assetId?: string;
}

interface PhotoRating {
  mu: number;
  sigma: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
}

type ComparisonOutcome =
  | { type: "left" }
  | { type: "right" }
  | { type: "draw" }
  | { type: "skip" };

interface ComparisonRecord {
  id: string;
  leftPhotoId: PhotoId;
  rightPhotoId: PhotoId;
  outcome: ComparisonOutcome;
  createdAt: number;
}

interface PhotoGroup {
  id: GroupId;
  photoIds: PhotoId[];
  representativePhotoId: PhotoId;
  source: "automatic" | "reviewed";
}

interface SimilarityResult {
  leftPhotoId: PhotoId;
  rightPhotoId: PhotoId;
  similarity: number;
}

interface CarouselRecommendation {
  orderedPhotoIds: PhotoId[];
  coverPhotoId: PhotoId;
  sourceGroupIds: GroupId[];
  targetSize: number;
  selectionMethod: "mmr";
}
```

TypeScript strict.

---

# 26. ESTADO Y PERSISTENCIA

Separar:

* configuración de sesión;
* historial de comparaciones;
* ratings calculados;
* estabilidad;
* estado del análisis visual;
* grupos automáticos;
* grupos revisados;
* carrusel recomendado;
* edición manual del carrusel.

Persistencia:

* priorizar que la sesión actual funcione correctamente;
* persistir configuración e historial cuando sea simple y fiable;
* no persistir embeddings ni matriz de similitud en el MVP;
* nunca persistir Base64 de imágenes originales;
* si las URIs no sobreviven reinicios en alguna plataforma, documentarlo y ofrecer recuperación clara;
* manejar background/foreground sin perder una sesión activa cuando sea razonable.

---

# 27. RENDIMIENTO

Las fotos de teléfonos pueden ser grandes.

Evitar:

* decodificar simultáneamente muchas imágenes full-resolution;
* Base64 persistente;
* copias innecesarias;
* inferencia en paralelo sin límite;
* bloquear la interfaz durante análisis o Monte Carlo.

Usar:

* thumbnails para listas;
* carga full-resolution solo al ampliar;
* precarga limitada de próximas comparaciones;
* procesamiento secuencial o con concurrencia muy baja;
* Web Worker para inferencia web si el runtime bloquea el hilo principal;
* cleanup explícito de tensores, sesiones y recursos temporales.

La pantalla de análisis debe seguir respondiendo mientras se procesan fotos.

---

# 28. TESTING TÉCNICO DEL RANKING

Crear unit tests independientes de UI.

Probar como mínimo:

1. winner mejora relativamente frente al loser;
2. skip no altera ratings;
3. draw conserva simetría con priors iguales;
4. draw acerca estimaciones con priors distintos;
5. incertidumbre evoluciona sin NaN/Infinity;
6. selector evita repeticiones innecesarias;
7. existe cobertura inicial;
8. luego prioriza la frontera Top K;
9. balancea razonablemente izquierda/derecha;
10. cooldown después de skip;
11. `getTopK()` devuelve exactamente K;
12. K = 1;
13. K = N;
14. pocas fotos;
15. Monte Carlo devuelve probabilidades válidas;
16. RNG determinista;
17. undo restaura el estado correcto;
18. el historial puede reconstruir la sesión.

No intentar demostrar mediante tests cuál foto debería gustarle a una persona.

## Benchmark de rapidez y fidelidad

Antes de cerrar la Fase 3.1, crear `tools/ranking-benchmark/` y exponer el comando
estable `npm run benchmark:ranking`. Debe ejecutar sesiones completas sin React
Native, con RNG inyectado, y producir un resultado JSON reproducible más un
resumen legible. No inventar resultados si el comando todavía no existe.

Comparar como mínimo:

1. implementación actual como baseline congelada;
2. cobertura de una comparación con selector actual;
3. cobertura de una comparación con retador de frontera;
4. retador de frontera con `expectedTopKOverlap` y el nuevo stop;
5. variantes razonables de thresholds y pesos, usando los mismos seeds.

Cada configuración se evalúa con perfiles determinista, consistente, humano
habitual y altamente ambiguo. El simulador puede usar Bradley-Terry/logística
sobre utilidades latentes derivadas de los tiers para que fotos cercanas tengan
más draws y resultados contradictorios. También debe variar `skip`, sesgo de
lado y repetición inconsistente. Este modelo simula ruido; no afirma modelar
universalmente el gusto humano.

Métricas obligatorias:

* comparaciones presentadas e informativas: media, mediana y percentil 90;
* solapamiento con el Top K objetivo;
* frecuencia de Top K exacto como diagnóstico, no objetivo único;
* recall de las primeras `min(3, K)` fotos;
* calidad del orden interno mediante una métrica tolerante a tiers;
* frecuencia de checkpoints, extensiones y resolución manual final;
* calibración entre estabilidad declarada y fidelidad empírica;
* comportamiento con draw, skip, empates y resultados contradictorios.

La corrida corregida demostró que no es válido agregar con el mismo peso los
perfiles determinista, consistente, habitual y altamente ambiguo: el último no
contiene señal estable suficiente para exigir recuperación automática con el
mismo presupuesto. Evaluar y reportar cada perfil por separado.

Para el escenario principal `N = 20–30`, `K = 5`, usar estas reglas de
evaluación mientras se obtiene calibración humana:

* `2N` se mide como checkpoint de UX, no como gate de finalización automática;
* ninguna sesión automática supera el límite de seguridad `4N` salvo el mínimo
  estructural `checkpoint + extensionBlock`;
* overlap, recall de favoritas y al menos K-1 aciertos se reportan por perfil y
  fixture, no solo como promedio global;
* `ambiguous` es un stress/fallback: medir activación y corrección manual, no
  exigir que el posterior recupere un target estable inexistente;
* medir por separado resultado automático y selección final resuelta por el
  usuario;
* no congelar nuevos thresholds numéricos de fidelidad hasta contrastarlos con
  sesiones humanas y holdout.

Estos gates son hipótesis iniciales. Elegir una configuración por su frontera de
Pareto entre fidelidad y esfuerzo, no mediante un puntaje opaco que permita
ocultar una regresión importante.

## Fixtures personales y calibración humana

Las fotos personales se guardan únicamente en
`local-data/ranking/<album>/photos/`, directorio ignorado por Git. Cada álbum
incluye un `target.json` local con K y tiers ordenados:

```json
{
  "k": 5,
  "tiers": [
    ["IMG_008.jpg"],
    ["IMG_014.jpg"],
    ["IMG_003.jpg", "IMG_019.jpg"],
    ["IMG_011.jpg"],
    ["IMG_006.jpg", "IMG_021.jpg"],
    ["IMG_002.jpg"]
  ]
}
```

Cada archivo aparece exactamente una vez. Fotos dentro del mismo tier se
consideran aproximadamente equivalentes; si un tier cruza la frontera K,
cualquiera de sus integrantes equivalentes puede satisfacer esa posición. Un
orden exacto se expresa con una foto por tier.

Usar idealmente al menos dos álbumes para ajustar y un tercero como holdout. Las
fotos no son necesarias para la simulación pura, pero sí para calibrar el ruido
personal mediante una sesión local estratificada por distancia de ranking. Esa
calibración debe incluir comparaciones cercanas, medias y lejanas, además de
algunas repeticiones posteriores con lados invertidos, y estimar consistencia,
draw, skip y sesgo de posición. No subir fotos, preferencias ni resultados.

No elegir parámetros usando el álbum holdout. Después del benchmark, validar la
configuración ganadora con sesiones humanas completas antes de congelarla en el
brief.

---

# 29. TESTING TÉCNICO DE SIMILITUD Y GRUPOS

No evaluar automáticamente belleza, gusto ni la “corrección estética” de un grupo.

Sí probar la corrección técnica:

* modelo carga en Web y Android;
* carga y paridad en iOS quedan registradas como validación diferida y no bloqueante mientras la pausa esté activa;
* `MODEL_MANIFEST.json` no contiene placeholders y satisface su contrato;
* SHA-256 del checkpoint y del ONNX coinciden con el manifiesto;
* el modelo expone únicamente `image [1, 3, 224, 224] float32` y `embedding [1, 576] float32`;
* el ONNX coincide con el wrapper PyTorch de referencia dentro de tolerancia;
* embeddings tienen exactamente 576 componentes;
* embeddings no contienen NaN/Infinity;
* salida L2-normalizada dentro de tolerancia;
* misma foto produce resultados deterministas dentro de tolerancia;
* matriz simétrica y diagonal válida;
* clustering con matrices sintéticas conocidas;
* threshold respetado;
* complete linkage no crea grupos por efecto cadena;
* cada foto pertenece exactamente a un grupo;
* separación, unión y movimiento conservan invariantes;
* representante inicial es la mejor rankeada del grupo;
* resultados equivalentes entre Web y Android dentro de tolerancia documentada;
* cancelar análisis libera recursos;
* un fallo del modelo no rompe Top K.

La calidad perceptual se valida manualmente con conjuntos de fotos reales y usuarios. Registrar durante pruebas:

* grupos aceptados sin cambios;
* separaciones necesarias;
* uniones necesarias;
* tiempo de revisión;
* comentarios cualitativos.

Usar esa evidencia para ajustar `similarityThreshold`, sin convertirla en telemetría de producción.

---

# 30. TESTING TÉCNICO DEL CARRUSEL

Probar:

* candidatas incluyen una representante de cada grupo confirmado;
* selección automática usa como máximo una representante por grupo;
* no hay duplicados;
* portada = representante mejor rankeada entre todas las candidatas;
* con al menos K grupos, el carrusel contiene exactamente K fotos;
* redundancias dentro del Top K se reemplazan con representantes de otros grupos;
* con menos de K grupos, el carrusel contiene exactamente `confirmedGroupCount` fotos;
* K = 1 produce una foto;
* un único grupo produce estado de variedad insuficiente;
* MMR selecciona y ordena en una sola pasada determinista;
* normalización de ranking y similitud respeta `[0, 1]`;
* pesos suman 1;
* recomendaciones priorizan grupos ausentes;
* se puede agregar cualquier foto;
* una foto del mismo grupo genera aviso pero no bloqueo;
* reemplazos y reordenamientos son válidos;
* restaurar recomendación funciona;
* ninguna edición altera el ranking Top K.

No probar que el orden recomendado sea estéticamente universal. Esa evaluación corresponde a pruebas con personas.

---

# 31. TESTING UI Y E2E

Agregar tests razonables de componentes y flujo:

* Home muestra un único flujo principal;
* setup valida K;
* comparación actualiza sesión;
* skip no actualiza rating;
* undo funciona;
* se puede terminar Top K;
* resultado ofrece Crear carrusel;
* análisis muestra progreso y errores;
* revisión permite aceptar y corregir grupos;
* carrusel recomendado puede editarse;
* agregar cualquiera funciona;
* exportación local se invoca correctamente.

Crear fixtures de desarrollo para no seleccionar manualmente muchas fotos.

Para Web, si el entorno lo permite, usar Playwright para un smoke test:

```text
abrir app
→ cargar fixtures
→ realizar comparaciones
→ obtener Top K
→ ejecutar análisis visual
→ revisar grupos
→ obtener carrusel
→ editar resultado
```

Evitar tests frágiles dependientes de animaciones.

---

# 32. DEPENDENCIAS Y MODELO

Mantener pocas dependencias.

Dependencias esperadas:

* Expo;
* React Native;
* TypeScript;
* selector y manipulación de imágenes de Expo;
* `ts-trueskill` si es compatible;
* `onnxruntime-react-native`;
* `onnxruntime-web`.

Reglas:

* verificar compatibilidad antes de agregar dependencias;
* encapsular TrueSkill detrás de `RatingEngine`;
* encapsular ONNX detrás de `ImageEmbeddingEngine`;
* no descargar el modelo en cada sesión;
* empaquetar el ONNX y `MODEL_MANIFEST.json`;
* mantener el exportador y su lockfile versionados;
* verificar hashes, licencia y atribuciones durante el build;
* no cambiar el modelo sin revisar threshold y paridad entre las plataformas activas.

---

# 33. NO IMPLEMENTAR EN EL MVP

No implementar todavía:

* login;
* perfiles sociales;
* backend;
* base de datos cloud;
* comentarios;
* likes;
* sesiones públicas;
* integración directa con Instagram;
* IA que juzgue belleza;
* reconocimiento facial;
* identificación de personas;
* análisis biométrico;
* entrenamiento de modelos;
* modelos visuales grandes o generativos;
* generación de captions;
* monetización;
* anuncios;
* inferencia remota;
* búsqueda combinatoria de todos los carruseles.

Sí forman parte del MVP:

* embeddings visuales locales;
* clustering automático;
* revisión humana de grupos;
* recomendación variable y editable.

---

# 34. CALIDAD DE CÓDIGO

Requisitos:

* TypeScript strict;
* funciones pequeñas y con responsabilidad clara;
* nombres descriptivos;
* cero `any` innecesarios;
* algoritmos puros cuando sea posible;
* constantes configurables;
* errores tipados;
* cleanup explícito de recursos de ML;
* comentarios solo para decisiones no obvias;
* evitar abstracciones prematuras;
* evitar duplicación significativa;
* no crear arquitectura empresarial innecesaria.

Preferir claridad y comportamiento verificable.

---

# 35. DEFINITION OF DONE

La tarea está completa solamente cuando:

## Build

* Web arranca correctamente;
* Development Build de Android compila y ejecuta;
* iOS permanece documentado como diferido y no validado; su Development Build no bloquea el cierre mientras la pausa esté activa;
* el modelo está empaquetado y disponible offline.

## Ranking

* se seleccionan fotos;
* se elige K;
* comparaciones funcionan;
* draw, skip y undo funcionan;
* cobertura inicial requiere solo una comparación informativa por foto;
* selección adaptativa prioriza retadores de frontera y conserva exploración;
* `expectedTopKOverlap` funciona y está calibrado;
* coincidencia exacta del orden no bloquea la finalización;
* checkpoint `2N`, extensiones `0.5N`, límite de seguridad `4N` y resolución
  humana ampliada funcionan;
* la revisión voluntaria desde 20 decisiones con cobertura completa confirma
  exactamente K sin alterar la confianza automática;
* resultado Top K funciona;
* el usuario puede detenerse o continuar;
* el benchmark reproducible satisface los gates acordados en fixtures de ajuste
  y mantiene resultados aceptables en holdout y pruebas humanas.

## Similitud y grupos

* todas las fotos válidas reciben embeddings;
* inferencia es local;
* arquitectura, pesos y punto de extracción coinciden con el modelo congelado;
* `MODEL_MANIFEST.json` contiene hashes y versiones reales y pasa validación;
* salida es un embedding L2-normalizado de 576 componentes;
* matriz de similitud funciona;
* clustering complete-linkage funciona;
* grupos automáticos se muestran;
* revisión permite corregirlos;
* fallos y cancelación son recuperables.

## Carrusel

* se construye después del Top K;
* considera representantes de todos los grupos confirmados;
* usa como máximo una representante por grupo automáticamente;
* contiene K fotos cuando existen al menos K grupos;
* solo contiene menos de K cuando hay menos de K grupos;
* MMR selecciona y ordena las fotos;
* portada automática funciona;
* recomendaciones para agregar funcionan;
* cualquier foto puede añadirse;
* quitar, reemplazar y reordenar funcionan;
* exportación local funciona.

## Calidad

* typecheck sin errores;
* lint sin errores importantes;
* unit tests técnicos pasan;
* tests de algoritmo pasan;
* smoke tests relevantes pasan;
* no hay errores de consola importantes;
* no quedan mocks de producción ni TODOs accidentales.

## UX

* usable en Android y Web;
* fotos no se recortan durante comparación;
* análisis no bloquea la UI;
* estados loading/error/empty están resueltos;
* navegación y back funcionan;
* acciones destructivas se confirman;
* accesibilidad básica funciona.

## Documentación

* README explica instalación y comandos;
* `AGENTS.md` está actualizado;
* arquitectura documentada;
* ranking documentado;
* modelo, preprocesamiento, threshold y clustering documentados;
* limitaciones reales registradas.

---

# 36. VALIDACIÓN FINAL OBLIGATORIA

Antes de finalizar:

1. ejecutar instalación limpia si es razonable;
2. ejecutar TypeScript typecheck;
3. ejecutar lint;
4. ejecutar unit tests;
5. ejecutar tests de ranking, clustering y carrusel;
6. ejecutar `npm run benchmark:ranking` y conservar su reporte reproducible;
7. levantar Web;
8. inspeccionar visualmente el flujo completo;
9. probar Development Build en Android;
10. registrar iOS como diferido y no ejecutar trabajo nativo de Apple mientras la pausa esté activa; retomar su Development Build solo tras indicación expresa del usuario;
11. ejecutar smoke/E2E disponibles;
12. revisar consola por errores;
13. revisar memoria y cleanup durante análisis visual;
14. revisar `git diff`;
15. buscar código muerto, TODOs accidentales y mocks activos;
16. corregir problemas encontrados;
17. repetir validaciones relevantes.

Al terminar, entregar un reporte breve con:

* arquitectura final;
* principales decisiones;
* archivos importantes;
* algoritmo de ranking;
* modelo y pipeline de similitud;
* algoritmo de agrupamiento;
* lógica del carrusel;
* comandos y tests ejecutados;
* resultados;
* limitaciones reales;
* próximos pasos opcionales.

Priorizar que el producto funcione de extremo a extremo sobre producir documentación o complejidad innecesaria.
