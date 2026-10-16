import { freezeJson, validateRequest } from './validation.mjs';

function build(question) {
  // Builders validate questions independently of any inference provider or model.
  const { questions } = validateRequest({ state: '', questions: { value: question } }, 'validation-only');
  return freezeJson(questions.value);
}

export const choice = (instructions, criteria) => build({ type: 'choice', instructions,
    ...(Array.isArray(criteria) ? { options: criteria } : { criteria }) });
export const noul = (instructions, criteria) => build({
  type: 'noul', instructions, ...(criteria === undefined ? {} : { criteria }),
});
export const score = (instructions, criteria) => build({ type: 'score', instructions, criteria });
export const scoreLevels = (instructions, levels) => build({ type: 'score', instructions, levels });
/** One bounding box; use a separate noul to check whether the target is present. */
export const box = instructions => build({ type: 'box', instructions });
