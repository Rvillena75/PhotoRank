# Pipeline visual local

## Contrato congelado

El artefacto versionado es
`assets/models/mobilenet_v3_small_imagenet1k_v1_pooled_l2.onnx`:

- `torchvision.models.mobilenet_v3_small` con
  `MobileNet_V3_Small_Weights.IMAGENET1K_V1`;
- `features → AdaptiveAvgPool2d(1) → flatten → normalize(p=2, dim=1, eps=1e-12)`;
- `model.classifier` completamente excluido;
- ONNX opset 17, pesos y operaciones `float32`, sin cuantización;
- input `image float32 [1,3,224,224]` y output
  `embedding float32 [1,576]`, ambos estáticos.

Hashes verificados:

```text
checkpoint  047dcff4addef86ea5bc2eff13c9614dc11f47ab1160d0a71a25e7db994f4e1f
ONNX        9f509ca76501fc2087fdb972d0b20f7ee6b43be131b5c25888d56192f791f0e8
Web WASM    f533b5f21790563d7556c611c3835ac65848ee326da2689aac54ed7d9cc8c6a4
```

`assets/models/MODEL_MANIFEST.json` fija estos valores y el contrato completo.
La aplicación rechaza placeholders, contradicciones o un hash ONNX distinto.

## Preprocesamiento

Los adaptadores normalizan orientación EXIF y color sRGB/RGB, redimensionan el
lado corto a 256 conservando el aspecto con bilinear y antialiasing, hacen
center crop 224×224, convierten a `[0,1]` y normalizan en NCHW con:

```text
mean = [0.485, 0.456, 0.406]
std  = [0.229, 0.224, 0.225]
```

Web usa `createImageBitmap` y Canvas 2D con conversión de orientación/color del
navegador. El adaptador nativo usa `expo-image-manipulator`, decodifica un PNG
temporal sin pérdida y lo elimina siempre. Android es el objetivo nativo activo;
la misma implementación se conserva para iOS. Ambos adaptadores forman un único
tensor por foto.

## Runtimes y ciclo de vida

- Web: `onnxruntime-web` 1.18.0, backend WASM/CPU, ejecución secuencial y un hilo.
- Android: `onnxruntime-react-native` 1.24.3 en Development Builds.
- iOS: el mismo runtime y contrato quedan preservados, con desarrollo y validación diferidos.
- No se usa ONNX Runtime Extensions ni WebGPU.

La versión 1.24.3 publicada en npm usa `VersionNumber` en su configuración
Android, una API eliminada por Gradle 9. `tools/patch-onnxruntime-react-native.mjs`
aplica durante `postinstall` la corrección equivalente a la rama principal de
Microsoft: parsea explícitamente la versión major/minor de React Native y evita
`VersionNumber`. El script exige exactamente 1.24.3 y los fragmentos de origen
esperados; ante cualquier cambio falla en vez de parchear parcialmente.

El runtime Web 1.18 no expone metadata de shapes/tipos en su API pública. Por
eso la inicialización Web verifica el hash exacto del grafo ya inspeccionado por
el exportador y los nombres de sesión; crea el input desde el shape/tipo del
manifiesto y valida tipo, shape y norma de cada output. El adaptador nativo sí
valida directamente toda la metadata de input/output al crear la sesión.

`VisualAnalysisRunner` procesa todas las fotos válidas de la sesión, nunca solo
el Top K. Publica `completed/total`, permite cancelación cooperativa después de
la foto en curso y dispone tensores, sesión y temporales. Los embeddings viven
solo en un mapa en memoria y se borran al cancelar, fallar, reintentar, salir o
reiniciar. El error visual es recuperable y no altera ratings, historial ni Top
K.

## Reproducibilidad y paridad

`tools/model-export` contiene el wrapper, preprocesamiento de referencia,
dependencias Python exactas, exportador, verificador, seis imágenes fixture,
tensores preprocesados y embeddings esperados. Consulta su `README.md` para los
comandos.

La validación de referencia comprobó:

- hash del checkpoint antes de `torch.load` y hash completo del ONNX;
- `onnx.checker`, opset, único input/output, nombres, shapes y tipos;
- ausencia de operadores cuantizados y de matrices del classifier;
- determinismo, finitud, 576 componentes y norma L2;
- PyTorch frente a ONNX Runtime CPU para seis fixtures con tolerancia absoluta
  `1e-5`.

El error absoluto máximo observado fue `2.5629997e-6`. Las normas L2 quedaron
entre `0.9999997019` y `1.0000002384`.

## Estado de validación por plataforma

- **Python/PyTorch/ONNX Runtime CPU:** validado con los seis fixtures.
- **Web/Chromium:** build Metro y flujo completo validados; las seis fotos se
  preprocesaron e infirieron con el ONNX/WASM empaquetado, sin errores de consola.
  El adaptador valida shape, tipo, finitud y norma L2 de cada salida.
- **Android:** bundle Metro/Hermes generado correctamente con el ONNX empaquetado;
  el primer Development Build en EAS falló durante la evaluación Gradle de
  `onnxruntime-react-native` por el uso eliminado de `VersionNumber`. Se añadió
  el parche reproducible descrito arriba. El segundo build, ejecutado sin caché,
  terminó correctamente y generó un APK de desarrollo en EAS
  (`d4e881a3-7edd-46b3-8309-15b695b61a66`). La instalación, la ejecución de
  inferencia real y la paridad numérica en un dispositivo físico aún deben
  validarse. Esta validación permanece dentro del alcance activo.
- **iOS:** bundle Metro/Hermes generado correctamente con el ONNX empaquetado;
  Development Build y paridad numérica no validados. El desarrollo nativo de
  Apple está pausado por decisión de producto hasta que el usuario pueda
  recuperar acceso a su cuenta; no constituye un bloqueo actual.

La equivalencia numérica de los preprocesadores Web/Android contra los tensores
de referencia debe verificarse en hardware real antes de declarar la fase de
endurecimiento activa completa. La paridad iOS volverá a ser obligatoria cuando
se retome esa plataforma. No se cambió el modelo ni el preprocesamiento por esta
limitación.

La similitud coseno, matriz, complete-linkage, revisión de grupos y MMR no se
implementan en esta fase.
