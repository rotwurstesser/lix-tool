// First-start steps: welcome → model download → grammar checker question → ready → done.

export type SetupStep = 'welcome' | 'model' | 'grammar' | 'ready' | 'done';
export type SetupEvent = 'start' | 'modelInstalled' | 'grammarDone' | 'finish' | 'modelMissing';

const STEPS: ReadonlyArray<SetupStep> = ['welcome', 'model', 'grammar', 'ready', 'done'];

export function isSetupStep(value: unknown): value is SetupStep {
  return typeof value === 'string' && (STEPS as ReadonlyArray<string>).includes(value);
}

/** Where to begin on app start. An aborted setup resumes at its open step. */
export function initialStep(saved: unknown, modelInstalled: boolean): SetupStep {
  if (modelInstalled) return saved === 'grammar' || saved === 'ready' ? saved : 'done';
  return saved === 'model' || saved === 'grammar' || saved === 'ready' || saved === 'done' ? 'model' : 'welcome';
}

/** Next step for an event. Events that do not fit the step change nothing. */
export function nextStep(step: SetupStep, event: SetupEvent): SetupStep {
  switch (event) {
    case 'start':
      return step === 'welcome' ? 'model' : step;
    case 'modelInstalled':
      return step === 'model' || step === 'welcome' ? 'grammar' : step;
    case 'grammarDone':
      return step === 'grammar' ? 'ready' : step;
    case 'finish':
      return step === 'ready' ? 'done' : step;
    case 'modelMissing':
      return step === 'grammar' || step === 'ready' || step === 'done' ? 'model' : step;
  }
}
