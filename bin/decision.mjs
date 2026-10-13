#!/usr/bin/env node
import { runCli } from '../src/cli/main.mjs';

const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
// Stream errors are handled by write callbacks; avoid unhandled EPIPE events.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
process.exitCode = await runCli(process.argv.slice(2), { signal: controller.signal });
// An interrupted, backpressured pipe must not keep the process alive.
if (controller.signal.aborted) { process.stdin.destroy(); process.stdout.destroy(); }
process.removeListener('SIGINT', interrupt);
process.removeListener('SIGTERM', interrupt);
