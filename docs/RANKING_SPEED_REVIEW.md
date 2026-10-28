# Revisión de rapidez del ranking

## Problema observado

En la prueba con 20 fotos, el usuario señaló que no se repetían duelos, pero
algunos resultados parecían deducibles a partir de comparaciones anteriores.
El objetivo es reducir el esfuerzo para cerrar un Top K útil en el MVP.

El selector activo usa ratings, frontera y exposición. No comprueba caminos de
preferencia como A > B > C. TrueSkill actualiza los dos ratings que participan
en una respuesta; no transforma ese camino en nuevas respuestas del usuario.

## Exploración local

Los archivos de exploración están en
`local-data/ranking/speed-investigation/`, fuera de Git. No contienen fotos ni
preferencias humanas. Se conservaron los resultados anteriores en
`local-data/ranking/benchmark/latest.json` sin sobrescribirlos.

Se probaron cuatro sensibilidades de TrueSkill y varias prioridades de pares
con los mismos seeds por escenario. La exploración usó los fixtures de ajuste
de 20 y 30 fotos, cuatro perfiles, cuatro repeticiones y 200 muestras por
decisión. No se eligieron parámetros nuevos usando el holdout.

También se probó penalizar preferencias alcanzables en un grafo, excluyendo
empates, contradicciones directas y ciclos. En ese control, la penalización más
fuerte eliminó los duelos deducibles del perfil determinista, pero elevó las
decisiones medias de 57,1 a 73,0. En el perfil consistente pasó de 93,5 a 100.
Evitar esos duelos no bastó para satisfacer antes la confianza del posterior.

Estas exploraciones son diagnósticas y pequeñas. Sus fórmulas provisionales no
se promovieron a producción. No se cambiaron TrueSkill, sus parámetros, los
pesos del selector, los thresholds ni los presupuestos.

Como referencia adicional, se continuaron 96 sesiones sintéticas de ajuste,
con 12 repeticiones por combinación, para observar el Top K en N, 2N y 4N
decisiones. Para el perfil consistente, el overlap medio con sus tiers fue:

| Decisiones | Overlap automático |
|---|---:|
| N | 74,2% |
| 2N | 84,2% |
| 4N | 91,7% |

Son puntos de presupuesto fijo del simulador, no un tiempo medido con personas,
ni una garantía para el lote fotográfico. La corrección manual no se usó como
oráculo para mejorar esos porcentajes.

## Correcciones incorporadas

- La app conserva el resultado Monte Carlo calculado al actualizar la sesión;
  ya no lo repite durante el render. Saltar o deshacer un salto reutiliza la
  confianza, pues no cambia los ratings. La semilla ignora los saltos y los ids
  de eventos para no añadir ruido estadístico por esas acciones.
- La parada sigue la membresía del Top K mostrado, ordenado por mu. Antes
  seguía un segundo conjunto ordenado por probabilidades de inclusión, que
  podía cambiar por ruido Monte Carlo sin modificar el resultado mostrado.
- La variante `production-checkpoint-2n-hard-4n` del benchmark llama a la misma
  función de parada de la app y registra su decisión real de resolución manual.
- La baseline `legacy-membership` conserva ahora la regla histórica de parada
  por conjunto y orden en `tools/ranking-benchmark/legacy-stop.ts`. Ya no llama
  accidentalmente a la parada actual. Los motores de rating y selección siguen
  siendo compartidos; no es una copia integral de una instalación histórica.

Una corrida de verificación con ocho repeticiones, 500 muestras, tres fixtures
y las variantes histórica de una cobertura y producción produjo 192 sesiones.
El archivo es `production-shared-stop-500.json`. En las 96 sesiones de producción
el overlap medio fue 84,6%, el recall de favoritas 94,1% y la resolución manual
69,8%. La mediana y el P90 fueron 4N decisiones. Esto confirma que sigue siendo
necesario trabajar el esfuerzo del flujo; no demuestra una aceleración grande.

Los gates numéricos del reporte heredado siguen siendo hipótesis históricas.
No se usan para afirmar que la Fase 3.1 cumple los criterios actuales del brief.

## Decisión aprobada para el piloto

El usuario eligió habilitar **Terminar y revisar mi Top K** desde 20 decisiones
presentadas y con cobertura completa. Con 20 fotos puede revisar las cinco
recomendadas, reemplazar cualquiera y confirmar exactamente cinco. Se mantiene
la opción de seguir comparando hasta el límite actual de 80. El umbral de 20
decisiones es fijo y configurable; no escala con N.

La confirmación se registra como `user-confirmation`, separada del posterior y
del fallback `hard-limit`. No se etiqueta como estabilidad automática. El
benchmark sigue midiendo la ruta automática, sin atribuirle una elección humana
correcta a las 20. Falta comprobar con el usuario y su novia si la revisión
resulta suficientemente breve y útil.

## Verificación del cierre voluntario

Typecheck y lint pasan. La suite completa pasa con 55 tests en 12 suites. Las
pruebas incluyen el umbral 19/20, cobertura pendiente, reemplazo de una sugerida,
confirmación de exactamente K, confianza intacta, deshacer y continuación.

Se ejecutó además el flujo Web con las 20 fotografías del piloto en Microsoft
Edge de Windows, usando un perfil temporal aislado. La revisión no apareció a
las 19 decisiones y sí a las 20; mostró las 20 candidatas, permitió reemplazar
una foto y conservó el porcentaje automático. Después se pudo continuar a la
decisión 21, sin errores de consola. Se inspeccionaron capturas de escritorio y
viewport móvil. Se corrigió el recorte del botón de pausa en pantallas angostas.
Las evidencias están en `local-data/ranking/speed-investigation/early-review-web/`.
Esto no sustituye la prueba física Android, que sigue pendiente; iOS permanece
diferido.
