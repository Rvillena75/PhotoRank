# AGENTS.md

## Propósito

Este repositorio contiene PhotoRank, una aplicación local-first para:

1. obtener un Top K de fotos según comparaciones subjetivas del usuario;
2. detectar fotos visualmente similares en el dispositivo;
3. permitir que el usuario revise los grupos encontrados;
4. recomendar un carrusel diverso y editable.

`brief.md` es la fuente de verdad del producto y de los algoritmos. Si el código, otra documentación o una suposición contradicen el brief, prevalece el brief. No cambiar decisiones de producto silenciosamente: actualizar el brief solo con aprobación del usuario.

## Alcance activo de plataformas

- Web y Android son las plataformas activas.
- iOS continúa como plataforma planificada, pero su desarrollo y validación están
  pausados hasta que el usuario indique expresamente que puede retomarlos.
- No dedicar trabajo actual a cuenta de Apple, certificados, provisioning,
  CocoaPods, Xcode, simuladores, dispositivos ni builds de iOS.
- Conservar la configuración, los adaptadores y el código compartido compatibles
  con iOS. No eliminar soporte existente ni introducir incompatibilidades
  deliberadas, pero la validación iOS no bloquea ninguna fase activa.
- No afirmar que iOS funciona mientras permanezca sin validar; registrarlo como
  diferido en los reportes de estado.

## Estado actual

Las fases 1–4 están implementadas: fundación Expo + React Native + TypeScript,
ranking puro, flujo Top K y pipeline visual local. El artefacto ONNX, su
manifiesto, exportador reproducible y fixtures de paridad están versionados.
Web tiene validación funcional con inferencia real; la validación en
Development Build de Android ya compila en EAS. La instalación, inferencia y
paridad numérica en un dispositivo Android físico continúan pendientes y forman
parte del trabajo activo. La validación nativa de iOS está diferida por la pausa
de plataforma.

Las fases 5–7 (grupos, carrusel y endurecimiento final) no están implementadas.

La Fase 3.1 permanece abierta para calibración humana. El flujo activo usa una
comparación informativa de cobertura por foto, `2N` como checkpoint no
bloqueante, revisiones cada `0,5N` y `4N` como límite de seguridad. Si persiste
ambigüedad, el usuario confirma exactamente K fotos; esa resolución se conserva
separada del posterior. Los selectores experimentales del benchmark no están
conectados a producción.

Para el piloto del MVP, desde 20 decisiones presentadas y con cobertura completa
se ofrece una revisión voluntaria del Top K. Confirma exactamente K y registra
`source = user-confirmation`, sin aumentar la estabilidad ni bloquear seguir
comparando. El fallback obligatorio conserva `source = hard-limit`.

## Stack obligatorio

- Expo y React Native.
- TypeScript strict.
- Web y Android como objetivos activos desde una única base de producto; preservar la ruta iOS para retomarla después.
- Expo Development Builds para Android; ONNX Runtime no funciona dentro de Expo Go. Los Development Builds de iOS se retoman al levantar la pausa.
- `ts-trueskill` detrás de una interfaz propia, si su compatibilidad queda validada.
- `onnxruntime-react-native` para Android y, cuando se retome, iOS.
- `onnxruntime-web` con WASM/CPU como baseline web.
- Estado simple; Zustand es aceptable, Redux requiere una justificación concreta.
- Sin backend, autenticación, cloud, inferencia remota ni APIs de IA.

`onnxruntime-react-native` 1.24.3 necesita el parche reproducible de
`tools/patch-onnxruntime-react-native.mjs` para Gradle 9. No editar su copia en
`node_modules` manualmente. Al cambiar esa versión, revisar y validar el parche
antes de actualizar el lockfile.

## Arquitectura esperada

Separar UI, dominio e infraestructura:

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
assets/
  models/
docs/
tools/
  model-export/
```

Interfaces de dominio principales:

```ts
RatingEngine
PairSelectionEngine
TopKConfidenceEstimator
ImageEmbeddingEngine
PhotoSimilarityEngine
PhotoGroupingEngine
CarouselRecommendationEngine
```

Las librerías de TrueSkill y ONNX Runtime solo deben aparecer en adaptadores de infraestructura. Los algoritmos de ranking, confianza, agrupamiento y MMR deben ser funciones o servicios puros que puedan probarse sin React Native.

## Invariantes del producto

- Existe un solo flujo: selección → comparaciones → Top K → carrusel opcional.
- La app no define qué significa que una foto sea “mejor”.
- Una derrota nunca elimina una foto.
- El análisis visual comienza únicamente si el usuario elige crear un carrusel.
- Se analizan todas las fotos válidas de la sesión, no solo el Top K.
- El agrupamiento es automático y la revisión humana es obligatoria.
- La pantalla de revisión permite corregir grupos, pero no obliga a crearlos desde cero.
- En el MVP, `targetCarouselSize = K`.
- MMR considera una representante de cada grupo confirmado, selecciona y ordena en una sola pasada.
- Si existen al menos K grupos, el carrusel inicial contiene exactamente K fotos.
- Solo puede contener menos de K cuando existen menos de K grupos confirmados.
- La selección automática usa como máximo una foto por grupo.
- El usuario siempre puede reordenar, reemplazar, quitar o agregar cualquier foto.

## Modelo visual congelado

No sustituir ni reinterpretar el modelo definido en `brief.md`.

- Arquitectura: `torchvision.models.mobilenet_v3_small`.
- Pesos: `MobileNet_V3_Small_Weights.IMAGENET1K_V1`.
- Checkpoint: `mobilenet_v3_small-047dcff4.pth`.
- SHA-256 del checkpoint: `047dcff4addef86ea5bc2eff13c9614dc11f47ab1160d0a71a25e7db994f4e1f`.
- Extracción: `features → AdaptiveAvgPool2d(1) → flatten`.
- Excluir todo `model.classifier`.
- Salida: embedding `float32` L2-normalizado de 576 componentes.
- ONNX opset 17, batch estático 1, sin cuantización.
- Archivo: `mobilenet_v3_small_imagenet1k_v1_pooled_l2.onnx`.
- Manifiesto obligatorio: `MODEL_MANIFEST.json`.

El script de exportación, su lockfile, el ONNX, el manifiesto y los fixtures de paridad forman una unidad versionada. Cualquier cambio en pesos, preprocesamiento, punto de extracción, shape, opset o cuantización exige una nueva versión mayor del modelo y recalibrar el threshold de similitud.

## Privacidad y datos

- No subir fotos, thumbnails, embeddings, ratings ni matrices de similitud.
- No persistir Base64 de imágenes originales.
- No guardar embeddings ni la matriz de similitud en el MVP.
- No registrar paths, EXIF o metadata sensible innecesariamente.
- Mantener inferencia, ranking y recomendación disponibles offline.
- Liberar tensores, sesiones y recursos temporales explícitamente.

## Convenciones de implementación

- Mantener TypeScript strict y evitar `any`.
- Preferir funciones pequeñas, datos inmutables y resultados deterministas.
- Inyectar RNG donde un algoritmo use muestreo.
- Centralizar thresholds, pesos y límites; no dispersar constantes mágicas.
- Definir reglas estables de desempate mediante ids.
- No mezclar lógica matemática con componentes de UI.
- No optimizar ni cuantizar el modelo antes de tener una baseline correcta y medida.
- No agregar dependencias sin comprobar soporte en Web y Android. Evitar dependencias que rompan manifiestamente la ruta iOS preservada.
- No introducir TODOs, mocks o fixtures de desarrollo en rutas de producción.
- Preservar cambios del usuario y evitar reescrituras no relacionadas.

## Estrategia de implementación

Trabajar en fases verticales pequeñas. Cada fase debe terminar con código ejecutable, pruebas relevantes y documentación sincronizada.

1. **Fundación:** scaffolding, navegación, tema, configuración, CI local y documentación base.
2. **Ranking puro:** ratings, historial, draw/skip/undo, selección adaptativa y unit tests.
3. **Flujo Top K:** selector de fotos, comparación, estabilidad Monte Carlo, pausa y resultado.
4. **Pipeline visual:** exportador reproducible, ONNX, manifiesto, preprocesamiento y paridad Web/Android; la paridad iOS queda diferida.
5. **Grupos:** matriz de similitud, complete-linkage y pantalla de revisión.
6. **Carrusel:** selección/orden MMR, edición, reemplazos, agregar más y exportación local.
7. **Endurecimiento:** accesibilidad, rendimiento, errores, permisos, E2E y validación en dispositivos.

No construir UI definitiva sobre contratos algorítmicos todavía inestables. Primero cerrar cada motor con fixtures y tests, luego conectarlo a la interfaz.

## Modelos de agente recomendados

Cuando el entorno permita elegir modelo:

- `gpt-5.6-sol`, esfuerzo `high`: arquitectura, ranking probabilístico, Monte Carlo, exportación ONNX, paridad del modelo, clustering, MMR, debugging difícil y revisión final.
- `gpt-5.6-terra`, esfuerzo `medium` o `high`: scaffolding, pantallas, estado, navegación, adaptadores ya especificados, tests, accesibilidad y documentación.
- `gpt-5.6-luna`, esfuerzo `medium`: tareas mecánicas acotadas como fixtures, renombres, limpieza o ampliación repetitiva de tests; no delegarle decisiones de producto o ML sin revisión.

No dividir una fase entre varios agentes si comparten los mismos archivos o si la segunda tarea depende de decisiones todavía no cerradas. Paralelizar solo tareas independientes y revisar el resultado integrado con `gpt-5.6-sol` cuando el riesgo sea alto.

## Comandos

Después del scaffolding, `package.json` debe ofrecer estos comandos estables:

```bash
npm install
npm run start
npm run web
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

El exportador debe tener un comando reproducible documentado en `tools/model-export/README.md`. No inventar resultados: si un comando todavía no existe o una plataforma no puede validarse en el entorno actual, decirlo claramente.

## Validación mínima por cambio

- Cambios de dominio: unit tests dirigidos + `npm run typecheck`.
- Cambios de UI: typecheck, lint, tests de componente y revisión visual.
- Cambios de ranking: fixtures deterministas, casos K=1/K=N y reconstrucción desde historial.
- Cambios de similitud: paridad PyTorch/ONNX y Web/Android dentro de tolerancia; registrar la paridad iOS como pendiente no bloqueante.
- Cambios de agrupamiento: invariantes, threshold y caso de cadena para complete-linkage.
- Cambios de carrusel: tamaño objetivo, reemplazo de redundancias, unicidad por grupo, MMR y desempates.
- Antes de declarar una fase terminada: typecheck, lint y todos los tests relevantes.

## Definition of Done

La definición completa está en `brief.md`. Un agente no debe declarar la aplicación terminada solo porque Web funciona. Mientras la pausa de iOS esté activa, el cierre requiere, como mínimo, Web y un Development Build funcional en Android, modelo offline validado, flujo completo, pruebas técnicas, manejo de errores, accesibilidad básica y documentación actualizada. iOS debe quedar identificado como diferido y no validado, no como terminado.
