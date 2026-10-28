# Número de comparaciones según N y K

## Resultado

No existe un número ideal determinado solo por N y K para preferencias humanas.
También depende de la separación entre favoritas y descartadas, contradicciones,
empates y precisión exigida. Elegir el conjunto y ordenarlo son objetivos distintos.

Para el piloto de **20 fotos y K=5**, 40–60 comparaciones son un compromiso
práctico para probar antes de la revisión humana. No garantizan las cinco
correctas. Se conserva la opción aprobada de revisar desde 20; este estudio no
cambia el comportamiento ni los presupuestos de producción.

## Referencia matemática

Con preferencias estrictas, transitivas y sin errores, un torneo balanceado
puede identificar el conjunto Top K con este presupuesto suficiente:

```text
R = min(K, N-K)
B_torneo = (N-1) + (R-1) * ceil(log2(N)), si K < N
B_torneo = 0, si K = N y solo interesa la pertenencia
```

El primer extremo cuesta N-1 comparaciones. Un torneo conserva los resultados
en un árbol; extraer cada extremo adicional requiere actualizar como máximo
`ceil(log2(N))` niveles. Se pueden buscar las K mejores o las N-K peores y tomar
el complemento. Esta es una **cota superior de ese método**, no el mínimo
universal, ni una fórmula calibrada de TrueSkill. PhotoRank no implementa ese
torneo y sus respuestas pueden ser inconsistentes.

| N | K | Presupuesto suficiente del torneo sin ruido |
|---:|---:|---:|
| 10 | 3 | 17 |
| 10 | 5 | 25 |
| 20 | 1 | 19 |
| 20 | 3 | 29 |
| 20 | 5 | 39 |
| 20 | 10 | 64 |
| 30 | 5 | 49 |
| 30 | 10 | 74 |
| 50 | 5 | 73 |
| 50 | 10 | 103 |

Una cota inferior de pertenencia es
`max(N-1, ceil(log2(binomial(N,K))))` para `K < N`. Tampoco constituye un
presupuesto suficiente. Para K=N la selección es trivial, pero ordenar las N
fotos sigue requiriendo información. La app conserva su requisito de cobertura.

Ordenar K fotos ya seleccionadas desde cero requiere al menos
`ceil(log2(K!))` comparaciones binarias, en el peor caso sin empates ni ruido.
Merge sort necesita como máximo `K*ceil(log2(K)) - 2^ceil(log2(K)) + 1`.
Para K=5 son una cota inferior de 7 y una superior de 8. No se suman ciegamente
a las comparaciones de selección: el historial puede contener parte de esa
información, y con ruido pueden necesitarse repeticiones.

## Medición con el algoritmo actual

Se ejecutaron 4.000 sesiones sintéticas:

- N: 10, 20, 30 y 50.
- K: 1, 3, 5, 10, N/2, N-1 y N, cuando son válidos y sin duplicar valores.
- Dos tipos de álbum: preferencia estricta y diez tiers con equivalencias.
- Cuatro perfiles heredados del simulador: determinista, consistente, habitual
  y ambiguo. Los perfiles se reportan separados; no se mezclan para calibrar.
- Veinte repeticiones por combinación, con ids permutados independientemente
  del orden objetivo. Se usan números aleatorios comunes por escenario.
- Coordenadas de preferencia en 0–9 para que aumentar N no amplíe artificialmente
  la separación global entre gustos.
- Trayectorias hasta 4N decisiones presentadas, incluidos los saltos. Se observan
  puntos cada aproximadamente N/4; no se detienen al alcanzar estabilidad.

Se usa el RatingEngine y el selector adaptativo reales. No se cargan imágenes
ni se consultan modelos remotos. No se realiza Monte Carlo por decisión porque
el resultado evaluado es empírico contra la referencia sintética, no la confianza
interna. La estabilidad de la app y la fidelidad empírica no son la misma medida.

La recuperación de frontera es `1 - errores/min(K,N-K)`. Así, para K=N-1 no
se confunde un overlap inevitablemente alto con identificar correctamente la
única descartada. Los tiers reciben crédito limitado a su capacidad en el Top K.

La tabla completa está en `local-data/ranking/comparison-budget-study/budgets.csv`.
Sus presupuestos de 80%, 90% y 95% son el primer punto medido con cobertura
completa que mantiene ese promedio en los puntos posteriores hasta 4N. Una celda
vacía significa que no se sostuvo el objetivo dentro del horizonte, no cero ni
una estimación de cuántas comparaciones adicionales serían suficientes.

Ejemplos exploratorios para el perfil consistente:

| N | K | 90% de recuperación de frontera, con tiers / estricta |
|---:|---:|---:|
| 10 | 5 | 20 / 20 |
| 20 | 3 | 75 / no sostenido hasta 80 |
| 20 | 5 | 35 / 50 |
| 20 | 10 | 45 / 45 |
| 30 | 5 | 48 / no sostenido hasta 120 |
| 30 | 10 | 80 / 88 |
| 50 | 5 | no sostenido hasta 200 / no sostenido hasta 200 |

Estos datos no justifican ajustar una fórmula universal a N y K. En particular,
la validación independiente del caso 20/5 cambió la estimación exploratoria.

## Validación independiente de N=20, K=5

Se añadieron 640 sesiones con repeticiones 20–99, sin reutilizar las 0–19 de la
exploración. Son 80 por perfil y tipo de álbum. No se ajustaron parámetros con
esas sesiones. Para el perfil consistente, el rango entre estricta y tiers fue:

| Decisiones | Overlap medio | Frecuencia de acertar las cinco |
|---:|---:|---:|
| 20 | 70,8–74,8% | 7,5–16,3% |
| 30 | 79,8–83,3% | 23,8–27,5% |
| 40 | 84,5–87,5% | 32,5–43,8% |
| 50 | 87,0–91,3% | 42,5–58,8% |
| 60 | 88,5–92,8% | 45,0–63,8% |
| 80 | 88,5–93,5% | 46,3–68,8% |

Los rangos son sensibilidad a dos tipos de álbum, no intervalos de confianza.
Un overlap medio de 90% equivale a 4,5 de cinco en promedio; no significa una
probabilidad de 90% de acertar las cinco. Las comparaciones de orden interno
correctas quedaron entre 64,1% y 77,1% a las 80 decisiones. La estrategia actual
concentra evidencia en la frontera, no en afinar el orden de las cinco.

La mejora entre 20 y 40 decisiones es grande en este control. Entre 60 y 80
es pequeña. De ahí la propuesta práctica de 40–60 más revisión humana para
este caso, manteniendo 20 como salida breve voluntaria. No se extrapola esa
propuesta a usuarios reales ni a otros N y K como garantía.

## Reproducir

```bash
node_modules/.bin/tsx tools/ranking-benchmark/run-comparison-budget-study.ts
node_modules/.bin/tsx tools/ranking-benchmark/summarize-comparison-budget-study.ts
node_modules/.bin/tsx tools/ranking-benchmark/validate-comparison-budget-study.ts
```

La primera corrida usa 20 repeticiones por combinación; se puede cambiar con
`PHOTORANK_BUDGET_REPETITIONS`. El estudio guarda configuración, perfiles y
hashes de los archivos principales. La validación puede contrastarse sin
sobrescribirla con `validate-comparison-budget-study.ts --verify-first`.
Los resultados se escriben en `local-data/ranking/comparison-budget-study/`,
fuera de Git. No se sobrescribe el benchmark histórico `latest.json`.

Referencias para distinguir selección exacta, aproximada y orden:

- Ren, Liu y Shroff: [The Sample Complexity of Best-k Items Selection from
  Pairwise Comparisons](https://arxiv.org/abs/2007.03133).
- Mohajer, Suh y Elmahdy: [Active Learning for Top-K Rank Aggregation from Noisy
  Comparisons](https://proceedings.mlr.press/v70/mohajer17a.html).
