import { createBridge, evaluateBatch, noul } from '../src/index.mjs';

try {
  const bridge = createBridge({ jev: {} });
  const questions = { failure: noul('Does the evidence explicitly report a failed test?') };
  const requests = ['18 passed, 2 failed.', 'Tests were not run.'].map(state => ({ state, questions }));
  const records = await evaluateBatch(bridge, requests, { concurrency: 2 });
  console.log(JSON.stringify(records, null, 2));
  if (records.some(record => !record.ok)) process.exitCode = 1;
} catch (error) {
  console.error(error.code ?? 'ERROR', error.message);
  process.exitCode = 1;
}
