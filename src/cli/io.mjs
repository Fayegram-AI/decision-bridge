import { createReadStream } from 'node:fs';
import { open, link, unlink, rename, lstat, stat, realpath } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DecisionError, requireCondition as check } from '../errors.mjs';
import { withSignal, abortError } from '../async.mjs';

export const INPUT_LIMIT = 8 * 1024 * 1024;

/** Reject same-file output, including directory aliases and case-insensitive paths. */
export async function assertDistinctFiles(input, output, cwd) {
  const source = resolve(cwd, input); const target = resolve(cwd, output);
  check(source !== target, 'Output must not replace the input file.', 'USAGE_ERROR');
  try {
    const [sourcePath, targetPath] = await Promise.all([realpath(source), realpath(target)]);
    check(sourcePath !== targetPath, 'Output must not replace the input file.', 'USAGE_ERROR');
    const [left, right] = await Promise.all([stat(sourcePath, { bigint: true }), stat(targetPath, { bigint: true })]);
    check(!(left.dev === right.dev && left.ino === right.ino),
      'Output must not replace the input file.', 'USAGE_ERROR');
  } catch (error) {
    // A nonexistent output cannot alias an existing input. Missing inputs are
    // reported by the normal input reader, before any inference is dispatched.
    if (error?.code === 'ENOENT') return;
    if (error instanceof DecisionError) throw error;
    throw new DecisionError('Cannot verify input/output file identity.', { code: 'IO_ERROR' });
  }
}

async function* chunks(path, { stdin, cwd, signal }, limit) {
  let input;
  if (path === '-') input = stdin;
  else {
    try {
      const file = resolve(cwd, path);
      const info = await stat(file);
      // Symlinks are accepted for read-only requests, unlike exclusive output files.
      check(info.isFile(), 'Input must be a regular file.', 'IO_ERROR');
      input = createReadStream(file);
    } catch (error) {
      if (error instanceof DecisionError) throw error;
      throw new DecisionError('Cannot open input file.', { code: 'IO_ERROR' });
    }
  }
  check(input && !input.isTTY, 'No piped input was supplied on stdin.', 'USAGE_ERROR');
  let total = 0;
  const iterator = input[Symbol.asyncIterator]();
  try {
    while (true) {
      if (signal?.aborted) throw abortError();
      const { value, done } = await withSignal(iterator.next(), signal);
      if (done) break;
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
      total += buffer.length;
      check(total <= limit, 'Input exceeds the byte limit.', 'INPUT_TOO_LARGE');
      yield buffer;
    }
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (error instanceof DecisionError) throw error;
    throw new DecisionError('Cannot read input.', { code: 'IO_ERROR' });
  } finally {
    if (path !== '-' || signal?.aborted) input.destroy?.();
    // Closing a file/pipe breaks pending reads without waiting on custom streams.
    iterator.return?.().catch(() => {});
  }
}

export async function readJson(path, context) {
  const buffers = [];
  for await (const chunk of chunks(path, context, context.maxInputBytes ?? INPUT_LIMIT)) buffers.push(chunk);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(buffers))); }
  catch { throw new DecisionError('Input is not valid UTF-8 JSON.', { code: 'VALIDATION_ERROR' }); }
}

/** Streaming JSONL: provider-specific per-line limit, total 64 MiB; blanks ignored. */
export async function* readJsonLines(path, context) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const lineLimit = context.maxInputBytes ?? INPUT_LIMIT;
  let pending = '';
  let line = 0;
  function parse(text) {
    try { return { line, input: JSON.parse(text) }; }
    catch { return { line, error: { code: 'VALIDATION_ERROR', message: 'Line is not valid JSON.' } }; }
  }
  try {
    for await (const chunk of chunks(path, context, 64 * 1024 * 1024)) {
      pending += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        const text = pending.slice(0, end).replace(/\r$/, '');
        pending = pending.slice(end + 1);
        line++;
        check(Buffer.byteLength(text) <= lineLimit, 'A JSONL line exceeds the byte limit.', 'INPUT_TOO_LARGE');
        if (text.trim()) yield parse(text);
      }
      // A trailing CR may be half of a split CRLF delimiter, not record content.
      const delimiterBytes = pending.endsWith('\r') ? 1 : 0;
      check(Buffer.byteLength(pending) - delimiterBytes <= lineLimit,
        'A JSONL line exceeds the byte limit.', 'INPUT_TOO_LARGE');
    }
    pending += decoder.decode();
    // At EOF an unpaired CR is content; it cannot enlarge the record ceiling.
    check(Buffer.byteLength(pending) <= lineLimit, 'A JSONL line exceeds the byte limit.', 'INPUT_TOO_LARGE');
    if (pending.trim()) { line++; yield parse(pending); }
  } catch (error) {
    if (error instanceof DecisionError) throw error;
    throw new DecisionError('JSONL input contains invalid UTF-8.', { code: 'VALIDATION_ERROR' });
  }
}

function writeStream(stream, text) {
  return new Promise((resolvePromise, reject) => {
    stream.write(text, error => error ? reject(error) : resolvePromise());
  });
}

/** Atomic file output, exclusive unless force is explicit. Files are mode 0600. */
export async function createWriter({ output, force = false, stdout, cwd, signal }) {
  const checkCancelled = () => { if (signal?.aborted) throw abortError(); };
  checkCancelled();
  if (!output || output === '-') return {
    async write(text) {
      if (signal?.aborted) throw abortError();
      await withSignal(writeStream(stdout, text), signal);
    },
    finish: async () => {}, abort: async () => {},
  };
  const target = resolve(cwd, output);
  if (!force) {
    try {
      await lstat(target);
      throw new DecisionError('Output already exists; use --force to replace it.', { code: 'IO_ERROR' });
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        if (error instanceof DecisionError) throw error;
        throw new DecisionError('Cannot inspect output path.', { code: 'IO_ERROR' });
      }
    }
  }
  const temporary = resolve(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  let handle;
  try { handle = await open(temporary, 'wx', 0o600); }
  catch { throw new DecisionError('Cannot create output file.', { code: 'IO_ERROR' }); }
  let closed = false;
  async function close() { if (!closed) { closed = true; await handle.close(); } }
  return {
    async write(text) {
      try { checkCancelled(); await handle.writeFile(text); checkCancelled(); }
      catch (error) {
        if (error instanceof DecisionError) throw error;
        throw new DecisionError('Cannot write output file.', { code: 'IO_ERROR' });
      }
    },
    async finish() {
      try {
        checkCancelled();
        await handle.sync();
        checkCancelled();
        await close();
        checkCancelled();
        // Once submitted, the atomic filesystem commit cannot be retracted.
        if (force) await rename(temporary, target);
        else { await link(temporary, target); await unlink(temporary); }
      } catch (error) {
        if (error instanceof DecisionError) throw error;
        throw new DecisionError('Cannot finalize output file; existing output was not overwritten without --force.', { code: 'IO_ERROR' });
      }
    },
    async abort() { await close().catch(() => {}); await unlink(temporary).catch(() => {}); },
  };
}
