import { createBridge, createProvider, choice, noul, score, decideChoice, type Bridge, type DecisionProvider } from '../src/index.mjs';

const bridge: Bridge = createBridge({ jev: { apiKey: 'typecheck-only' } });
async function typeChecks() {
  const result = await bridge.evaluate({
    state: { message: 'sample' },
    questions: {
      route: choice('Route?', { inspect: null, stop: 'Stop.' }),
      numericRoute: choice('Numeric route?', { 0: 'Inspect.', 1: 'Stop.' }),
      yes: noul('Yes?'),
      level: score('Level?', ['Low', 'High']),
    },
  });
  const label: 'inspect' | 'stop' = result.answers.route.choice;
  const numericLabel: '0' | '1' = result.answers.numericRoute.choice;
  const probability: number = result.answers.yes.noul;
  const level: number = result.answers.level.score;
  const decision = decideChoice(result.answers.route, { minProbability: 0.8, abstainOptions: ['stop'] });
  // @ts-expect-error Noul answers do not have choice.
  result.answers.yes.choice;
  // @ts-expect-error Choice union does not include arbitrary labels.
  const wrong: 'missing' = result.answers.route.choice;
  // @ts-expect-error No unknown answer key.
  result.answers.missing;
  // @ts-expect-error A score needs at least two levels.
  score('Level?', ['One']);
  // @ts-expect-error A policy threshold must be explicit.
  decideChoice(result.answers.route, {});
  return { label, numericLabel, probability, level, decision };
}
void typeChecks; // Type checking only. No inference is executed.
const provider: DecisionProvider = {
  kind: 'decision', name: 'future-backend', defaultModel: 'some-model',
  async evaluate() { throw new Error('Implementation intentionally omitted; never executed.'); },
};
createBridge({ provider });
// @ts-expect-error Provider and Jev options are mutually exclusive.
createBridge({ provider, jev: { apiKey: 'not-used' } });
// @ts-expect-error SDK selection is required.
createBridge();
// @ts-expect-error Empty options do not select a provider.
createBridge({});
// @ts-expect-error An undefined selector does not select a provider.
createBridge({ jev: undefined });
// @ts-expect-error Null is not a provider.
createBridge({ provider: null });
// @ts-expect-error Null is not Jev configuration.
createBridge({ jev: null });
createBridge({ jev: {} });
createBridge({ provider, jev: undefined });
// @ts-expect-error Provider factory selection is required.
createProvider();
// @ts-expect-error Provider factory type is required.
createProvider({ apiKey: 'not-used' });
