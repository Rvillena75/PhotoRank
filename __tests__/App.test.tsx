import { fireEvent, render, waitFor } from '@testing-library/react-native';

import App from '../App';
import type { ImageEmbeddingEngine } from '../src/domain/contracts';
import { MonteCarloTopKConfidenceEstimator } from '../src/domain/confidence';

describe('Top K flow', () => {
  it('estimates confidence once per rated decision and keeps it unchanged on skip', () => {
    const estimate = jest.spyOn(MonteCarloTopKConfidenceEstimator.prototype, 'estimate');
    try {
      const screen = render(<App />);
      fireEvent.press(screen.getByRole('button', { name: 'Comenzar' }));
      fireEvent.press(screen.getByRole('button', { name: 'Cargar 6 fotos de prueba' }));
      fireEvent.press(screen.getByRole('button', { name: 'Empezar comparaciones' }));
      expect(estimate).toHaveBeenCalledTimes(1);
      fireEvent.press(screen.getByRole('button', { name: 'Elegir izquierda' }));
      expect(estimate).toHaveBeenCalledTimes(2);
      fireEvent.press(screen.getByRole('button', { name: 'Saltar / No sé' }));
      expect(estimate).toHaveBeenCalledTimes(2);
      fireEvent.press(screen.getByRole('button', { name: 'Deshacer última decisión' }));
      expect(estimate).toHaveBeenCalledTimes(2);
      fireEvent.press(screen.getByRole('button', { name: 'Ver Top K provisional' }));
      expect(estimate).toHaveBeenCalledTimes(2);
    } finally {
      estimate.mockRestore();
    }
  });

  it('starts the single flow, loads development fixtures and validates setup', () => {
    const screen = render(<App />);

    fireEvent.press(screen.getByRole('button', { name: 'Comenzar' }));
    expect(screen.getByRole('header', { name: 'Prepara tu sesión' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Empezar comparaciones' }).props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(screen.getByRole('button', { name: 'Cargar 6 fotos de prueba' }));
    expect(screen.getByText('6 fotos seleccionadas')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Empezar comparaciones' }).props.accessibilityState?.disabled).toBeFalsy();
  });

  it('runs comparisons, supports skip and undo, then exposes the provisional Top K', () => {
    const screen = render(<App />);
    fireEvent.press(screen.getByRole('button', { name: 'Comenzar' }));
    fireEvent.press(screen.getByRole('button', { name: 'Cargar 6 fotos de prueba' }));
    fireEvent.press(screen.getByRole('button', { name: 'Empezar comparaciones' }));
    expect(screen.getByRole('header', { name: '¿Cuál prefieres?' })).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Saltar / No sé' }));
    fireEvent.press(screen.getByRole('button', { name: 'Deshacer última decisión' }));
    fireEvent.press(screen.getByRole('button', { name: 'Elegir izquierda' }));
    fireEvent.press(screen.getByRole('button', { name: 'Ver Top K provisional' }));

    expect(screen.getByRole('header', { name: 'Tu Top 5' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Crear carrusel' })).toBeTruthy();
  });

  it('supports K=1 and K=N from setup through the result', () => {
    const one = render(<App />);
    fireEvent.press(one.getByRole('button', { name: 'Comenzar' }));
    fireEvent.press(one.getByRole('button', { name: 'Cargar 6 fotos de prueba' }));
    for (let index = 0; index < 4; index += 1) fireEvent.press(one.getByRole('button', { name: 'Reducir K' }));
    fireEvent.press(one.getByRole('button', { name: 'Empezar comparaciones' }));
    fireEvent.press(one.getByRole('button', { name: 'Ver Top K provisional' }));
    expect(one.getByRole('header', { name: 'Tu Top 1' })).toBeTruthy();

    const all = render(<App />);
    fireEvent.press(all.getByRole('button', { name: 'Comenzar' }));
    fireEvent.press(all.getByRole('button', { name: 'Cargar 6 fotos de prueba' }));
    fireEvent.press(all.getByRole('button', { name: 'Aumentar K' }));
    fireEvent.press(all.getByRole('button', { name: 'Empezar comparaciones' }));
    fireEvent.press(all.getByRole('button', { name: 'Ver Top K provisional' }));
    expect(all.getByRole('header', { name: 'Tu Top 6' })).toBeTruthy();
  });

  it('treats 2N as a checkpoint and resolves ambiguity manually at the 4N safety limit', () => {
    const screen = render(<App />);
    fireEvent.press(screen.getByRole('button', { name: 'Comenzar' }));
    fireEvent.press(screen.getByRole('button', { name: 'Cargar 6 fotos de prueba' }));
    fireEvent.press(screen.getByRole('button', { name: 'Empezar comparaciones' }));

    for (let index = 0; index < 12; index += 1) {
      fireEvent.press(screen.getByRole('button', { name: 'Saltar / No sé' }));
    }
    expect(screen.getByText(/Llegaste a un punto de revisión/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Elegir izquierda' }).props.accessibilityState?.disabled).toBeFalsy();

    for (let index = 0; index < 12; index += 1) {
      fireEvent.press(screen.getByRole('button', { name: 'Saltar / No sé' }));
    }
    fireEvent.press(screen.getByRole('button', { name: 'Resolver mi Top K' }));
    expect(screen.getByRole('header', { name: 'Decide tu Top 5' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Confirmar mi Top 5' }));

    expect(screen.getByRole('header', { name: 'Tu Top 5' })).toBeTruthy();
    expect(screen.getByText(/combina el ranking estimado con tu resolución final/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Crear carrusel' })).toBeTruthy();
  });

  it('allows closing at 20 decisions, replacing a suggestion and continuing with the original posterior', () => {
    const screen = render(<App />);
    fireEvent.press(screen.getByRole('button', { name: 'Comenzar' }));
    fireEvent.press(screen.getByRole('button', { name: 'Cargar 6 fotos de prueba' }));
    fireEvent.press(screen.getByRole('button', { name: 'Empezar comparaciones' }));
    for (let index = 0; index < 19; index += 1) fireEvent.press(screen.getByRole('button', { name: 'Iguales' }));
    expect(screen.queryByRole('button', { name: 'Terminar y revisar mi Top 5' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Iguales' }));
    expect(screen.getByText('20 comparaciones realizadas')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Terminar y revisar mi Top 5' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Elegir izquierda' }).props.accessibilityState?.disabled).toBeFalsy();
    fireEvent.press(screen.getByRole('button', { name: 'Deshacer última decisión' }));
    expect(screen.queryByRole('button', { name: 'Terminar y revisar mi Top 5' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Iguales' }));
    fireEvent.press(screen.getByRole('button', { name: 'Ver Top K provisional' }));
    const originalStability = screen.getByText(/Estabilidad estimada del cálculo automático:/u).props.children;
    fireEvent.press(screen.getByRole('button', { name: 'Terminar y revisar mi Top 5' }));
    expect(screen.getAllByRole('button', { name: /^Ampliar candidata /u })).toHaveLength(6);
    const replacementLabel: string = screen.getByRole('button', { name: /^Elegir /u }).props.accessibilityLabel;
    fireEvent.press(screen.getAllByRole('button', { name: /^Quitar /u })[0]!);
    expect(screen.getByRole('button', { name: 'Confirmar mi Top 5' }).props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: replacementLabel }));
    fireEvent.press(screen.getByRole('button', { name: 'Confirmar mi Top 5' }));
    expect(screen.getByText(/combina el ranking estimado con tu resolución final/u)).toBeTruthy();
    expect(screen.getByText(/Estabilidad estimada del cálculo automático:/u).props.children).toEqual(originalStability);
    expect(screen.getByRole('button', { name: 'Crear carrusel' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Seguir comparando' }));
    fireEvent.press(screen.getByRole('button', { name: 'Iguales' }));
    expect(screen.getByText('21 comparaciones realizadas')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Ver Top K provisional' }));
    expect(screen.queryByText(/combina el ranking estimado con tu resolución final/u)).toBeNull();
  });

  it('keeps the Top K available when the local visual model fails and allows retry', async () => {
    const engine: ImageEmbeddingEngine = {
      initialize: jest.fn(async () => { throw new Error('runtime unavailable'); }),
      embed: jest.fn(async () => []),
      dispose: jest.fn(async () => undefined),
    };
    const createEngine = jest.fn(async () => engine);
    const screen = render(<App createEmbeddingEngine={createEngine} />);
    fireEvent.press(screen.getByRole('button', { name: 'Comenzar' }));
    fireEvent.press(screen.getByRole('button', { name: 'Cargar 6 fotos de prueba' }));
    fireEvent.press(screen.getByRole('button', { name: 'Empezar comparaciones' }));
    fireEvent.press(screen.getByRole('button', { name: 'Ver Top K provisional' }));
    fireEvent.press(screen.getByRole('button', { name: 'Crear carrusel' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Reintentar análisis' })).toBeTruthy());
    expect(screen.getByText(/Tu Top K sigue disponible/u)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Volver a mi Top K' }));
    expect(screen.getByRole('header', { name: 'Tu Top 5' })).toBeTruthy();
    expect(screen.getAllByText(/Estabilidad estimada/u)).toHaveLength(1);
  });
});
