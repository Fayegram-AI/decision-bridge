/** Explicit route selection and configurable automatic routing, independent of the CLI. */
import { makeRouter } from './router.mjs';
import { routedBatch } from './batch.mjs';

export const createDecisionRouter = options => makeRouter(options, 'decision');
export const createExtractionRouter = options => makeRouter(options, 'extraction');
export const evaluateRoutedBatch = (router, inputs, options = {}) => routedBatch(router, inputs, options, 'decision');
export const extractRoutedBatch = (router, inputs, options = {}) => routedBatch(router, inputs, options, 'extraction');
