# Prueba del MVP entre dos personas

La primera prueba la hacen el desarrollador y su novia, cada uno en una sesión
independiente. Se conserva el algoritmo actual. No se entrena un perfil personal
ni se reutilizan las decisiones de una persona para la otra.

El objetivo es comprobar si elegir un Top 5 resulta sencillo y útil. Esta prueba
de dos personas aporta observaciones del MVP; no demuestra precisión para una
población ni cierra por sí sola todas las fases del brief.

## Lote de ejemplo

Se preparó `local-data/ranking/piloto-mvp-ejemplo-v1/` con:

- `photos/`: 20 fotografías JPEG distintas, llamadas `foto-01.jpg` a
  `foto-20.jpg`, con su proporción original y lado mayor de hasta 1200 píxeles.
- `vista-previa.jpg`: hoja de contacto para reconocer los archivos. No se
  selecciona esta hoja dentro de PhotoRank.
- `MANIFEST.json`: procedencia, autor, dimensiones, tamaño y SHA-256 de cada foto.
- `resultados.csv`: dos registros vacíos, P01 y P02, marcados como pendientes.
- `COMO_PROBAR.md`: copia de esta guía para acompañar las fotos.
- `PhotoRank-prueba-20-fotos.zip`: fotos y materiales para trasladarlos al teléfono.

Las fotografías se descargaron desde [Lorem Picsum](https://picsum.photos/), que
identifica sus imágenes como procedentes de Unsplash. El manifiesto incluye el
enlace y autor individual. La licencia de las fotos está en
<https://unsplash.com/license>; no se les atribuye la licencia del código.
No hay un Top 5 correcto predefinido: cada participante elige según su gusto.

El lote y los resultados quedan fuera de Git porque `local-data/` está ignorado.
No se añadieron imágenes ni servicios remotos a la app. Después de descargar y
descomprimir el ZIP, la selección usa los archivos locales.

## Preparar la sesión

1. Descomprimir el ZIP y abrir `photos/`.
2. Cada participante puede anotar sus cinco favoritas de referencia antes de ver
   cualquier recomendación de PhotoRank. Si hay fotos intercambiables, anotarlo.
   No compartir esa selección con la otra persona hasta que ambas terminen.
3. Abrir PhotoRank. Para Web, desde la raíz del repositorio:

   ```bash
   EXPO_OFFLINE=1 npm run web -- --localhost --port 8081
   ```

4. Abrir `http://localhost:8081` en el navegador del mismo computador. Elegir
   **Comenzar → Elegir fotos** y seleccionar únicamente los 20 JPEG de `photos/`.
5. Mantener **K = 5** y pulsar **Empezar comparaciones**.

En Android se utiliza el mismo lote en un Development Build instalado. El equipo
previsto es un Samsung Galaxy S25 Ultra con One UI 8.5. La disponibilidad del
lote no implica que el APK ya esté instalado o validado. Expo Go no ejecuta el
runtime ONNX nativo.

## Realizar la prueba

1. Iniciar un cronómetro y responder según la preferencia personal. Usar
   **Iguales** o **Saltar / No sé** cuando corresponda.
2. Ampliar alguna foto y probar **Deshacer** y **Pausar → Continuar**. No forzar
   esas acciones si interfieren con la elección; también pueden revisarse en una
   sesión corta posterior.
3. A las **20 comparaciones realizadas**, si todas las fotos ya tuvieron una
   respuesta informativa, aparece **Terminar y revisar mi Top 5**. Para este
   piloto, probar esa salida. Los saltos cuentan para las 20 decisiones, pero no
   dan cobertura. La opción aparece al completar la cobertura si falta alguna.
4. Antes de confirmar, abrir **Ver Top K provisional** y anotar los nombres del
   Top 5 automático y su estabilidad. Desde ese resultado también se puede
   pulsar **Terminar y revisar mi Top 5**.
5. Revisar todas las fotos, reemplazar cualquiera y confirmar exactamente cinco.
   Registrar el Top 5 final por separado; no contar la corrección humana como
   acierto automático. Si se prefiere seguir comparando, se mantienen el
   checkpoint de 40, revisiones cada 10 y el límite de 80.
6. Detener el cronómetro. Anotar cuántas fotos cambiarían y si usarían ese Top 5.
7. Registrar un fallo, una dificultad o una sugerencia concreta, si los hubo.
8. Reiniciar y repetir con la otra persona. No reutilizar la sesión anterior.

La interfaz actual no exporta automáticamente el historial ni un reporte de
prueba. Los datos se anotan manualmente. Si no se contó el número de decisiones,
se deja vacío; no se deduce a partir del tiempo ni del límite.

La sesión vive en memoria: no recargar ni cerrar la app antes de registrar el
resultado. Pausar conserva la sesión mientras el proceso siga activo.

## Registro mínimo

Completar una fila de `resultados.csv` por persona. Usar nombres de archivo
separados por `;` para las listas. Las celdas sin medir quedan vacías.

- Estado: completada, provisional o interrumpida.
- Plataforma y versión/build usado, cuando esté disponible.
- Duración y decisiones, si se midieron.
- Top 5 de referencia, automático y final.
- Resolución manual: sí o no.
- Tipo de cierre: revisión voluntaria a partir de 20, estabilidad automática,
  límite de seguridad o resultado provisional.
- Cantidad de cambios que haría la persona y si le resultó útil.
- Errores y comentarios breves.

El registro es local y manual. No contiene embeddings, matrices ni bytes de las
fotos. Las preferencias de P01 y P02 se evalúan de forma independiente.

## Análisis visual opcional

Después de registrar el ranking se puede pulsar **Crear carrusel** para comprobar
que el análisis procesa las 20 fotos, permite cancelar y puede reintentarse.
Actualmente termina al obtener embeddings y permite volver al Top K: todavía
no agrupa fotos ni genera un carrusel. Este lote no trae grupos humanos
confirmados y no sirve por sí solo para calibrar el threshold de similitud.

Las fotos de ejemplo permiten recorrer el flujo. Después se puede repetir con
un álbum personal, que será más representativo del uso original de la app.
