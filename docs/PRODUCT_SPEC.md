# Product specification

PhotoRank ayuda a una persona a escoger sus fotos favoritas mediante comparaciones por pares y, opcionalmente, a convertir ese resultado en un carrusel diverso. El flujo único es: Home → selección → comparaciones → Top K → carrusel opcional → análisis local → revisión de grupos → carrusel recomendado.

La aplicación no define qué significa una foto mejor: la preferencia viene exclusivamente de la persona usuaria. Una derrota nunca elimina una foto. Todo el procesamiento será local; no hay backend, autenticación, subida de fotos ni telemetría.

Web y Android son las plataformas activas. iOS sigue planificado, pero su
desarrollo y validación están pausados hasta nueva indicación del usuario; se
conserva el soporte existente y la falta de validación iOS no bloquea el alcance
actual.

## Alcance implementado

La fase 1 entrega la base visual y navegable. La fase 2 añade el dominio puro de ranking: rating probabilístico, resultados left/right/draw/skip, historial inmutable, reconstrucción/undo, Top K provisional y selección adaptativa. La fase 3 conecta ese dominio a un flujo local de Top K completo. La fase 4 añade el pipeline visual local congelado.

El setup usa el selector de imágenes del sistema para cargar múltiples fotos, muestra la cantidad y permite quitar cada foto. Antes de comenzar valida un mínimo de dos fotos, K entero dentro de `1..N`, duplicados detectables por asset id o URI y fotos con carga fallida. No almacena Base64. Las fixtures de seis fotos solo aparecen bajo `__DEV__` para recorridos manuales y de componentes.

La comparación ofrece izquierda, derecha, iguales, saltar y deshacer, además de visor ampliado y atajos Web. Se puede pausar y ver el resultado provisional en cualquier momento. Reiniciar solicita confirmación. El resultado presenta el Top K, permite ampliar cada foto, compartir su archivo original mediante la hoja del sistema y compartir un manifiesto local con el orden y los nombres; no copia, persiste ni transmite las imágenes originales.

Crear carrusel analiza, solo tras ese gesto, todas las fotos válidas de la sesión mediante MobileNetV3 Small empaquetado. Se procesa una foto a la vez con progreso, cancelación y reintento. Los embeddings viven únicamente en memoria; cancelar o fallar los descarta, mantiene Top K operativo y vuelve a un estado recuperable.

La fase termina después de obtener embeddings válidos. Similitud, matriz,
clustering, revisión humana y recomendación MMR siguen explícitamente fuera de
alcance.
