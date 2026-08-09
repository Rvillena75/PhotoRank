import { fireEvent, render, waitFor } from '@testing-library/react-native';

import App from '../App';
import type { ImageEmbeddingEngine } from '../src/domain/contracts';

describe('Top K flow', () => {
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
    expect(screen.getAllByText(/Estabilidad de pertenencia/u)).toHaveLength(1);
  });
});
