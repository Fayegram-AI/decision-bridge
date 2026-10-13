import { runCli } from '../src/cli/main.mjs';
import { publicError } from '../src/errors.mjs';
import { runDecisionsSmoke } from './decisions-smoke.mjs';
if (process.env.RUN_LIVE_TESTS !== '1') {
  console.error('Live inference is opt-in and may incur charges. Set RUN_LIVE_TESTS=1 and provide the intended provider credentials.');
  process.exitCode = 2;
} else {
  const args = process.argv.slice(2);
  if (args.includes('--decisions')) {
    try { console.log(JSON.stringify(await runDecisionsSmoke(args.filter(arg => arg !== '--decisions')), null, 4)); }
    catch (error) { console.error(JSON.stringify({ error: publicError(error) })); process.exitCode = 1; }
  } else process.exitCode = await runCli(['evaluate', ...args]);
}
