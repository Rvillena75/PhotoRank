export type VisualAnalysisErrorCode =
  | 'cancelled'
  | 'integrity'
  | 'model-load'
  | 'preprocessing'
  | 'inference'
  | 'invalid-output';

export class VisualAnalysisError extends Error {
  readonly code: VisualAnalysisErrorCode;

  constructor(code: VisualAnalysisErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'VisualAnalysisError';
    this.code = code;
  }
}

export function visualAnalysisErrorMessage(error: unknown): string {
  if (!(error instanceof VisualAnalysisError)) {
    return 'No pudimos analizar las fotos en este dispositivo. Tu Top K sigue disponible.';
  }
  switch (error.code) {
    case 'integrity':
      return 'El modelo local no superó la verificación de integridad. Reinstala la app o vuelve a intentarlo.';
    case 'model-load':
      return 'El motor visual local no pudo iniciarse en este dispositivo. Puedes reintentar sin perder tu Top K.';
    case 'preprocessing':
      return 'Una foto no pudo prepararse para el análisis. Revisa que siga disponible e inténtalo de nuevo.';
    case 'invalid-output':
    case 'inference':
      return 'El modelo local devolvió un resultado inválido. Puedes reintentar sin perder tu Top K.';
    case 'cancelled':
      return 'El análisis fue cancelado. Tu Top K no cambió.';
  }
}
