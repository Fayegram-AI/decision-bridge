/** Large serialized payload checks run sequentially in a separate, collectible heap. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('Gemini full inline allowance and CLI/routing payloads exceed the former ceiling', { timeout: 180000 }, async () => {
    const { stdout } = await promisify(execFile)(process.execPath,
        ['--expose-gc', fileURLToPath(new URL('./gemini-payload.scenario.mjs', import.meta.url))],
        { timeout: 170000, maxBuffer: 1048576 });
    const result = JSON.parse(stdout);
    assert.equal(result.decodedBytes, 100000000);
    assert(result.serializedBytes > 64 * 1024 * 1024);
    assert.equal(result.sdkCalls, 2);
    assert.equal(result.cliChecks, 6);
});
