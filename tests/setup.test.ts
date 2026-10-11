import { describe, expect, it } from 'vitest';
import { initialStep, isSetupStep, nextStep } from '../lib/setup.ts';

describe('setup state machine', () => {
  it('starts with the welcome screen on a fresh install', () => {
    expect(initialStep(undefined, false)).toBe('welcome');
    expect(initialStep('garbage', false)).toBe('welcome');
  });

  it('resumes an aborted setup at the model step', () => {
    expect(initialStep('model', false)).toBe('model');
  });

  it('asks for the model again when it is gone', () => {
    expect(initialStep('done', false)).toBe('model');
  });

  it('goes to the generator when the model is installed', () => {
    expect(initialStep('done', true)).toBe('done');
    expect(initialStep(undefined, true)).toBe('done');
    expect(initialStep('ready', true)).toBe('ready');
  });

  it('walks welcome → model → ready → done', () => {
    let s = nextStep('welcome', 'start');
    expect(s).toBe('model');
    s = nextStep(s, 'modelInstalled');
    expect(s).toBe('ready');
    s = nextStep(s, 'finish');
    expect(s).toBe('done');
  });

  it('ignores events that do not fit the step', () => {
    expect(nextStep('welcome', 'finish')).toBe('welcome');
    expect(nextStep('done', 'start')).toBe('done');
    expect(nextStep('model', 'finish')).toBe('model');
    expect(nextStep('done', 'modelMissing')).toBe('model');
  });

  it('knows its steps', () => {
    expect(isSetupStep('ready')).toBe(true);
    expect(isSetupStep('grammar')).toBe(false);
  });
});
