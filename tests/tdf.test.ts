import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectBytes } from '../src/web/tdf.js';

test('collects a complete stream without corrupting binary data', async () => {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([0, 255]));
      controller.enqueue(new Uint8Array([42]));
      controller.close();
    },
  });
  assert.deepEqual(await collectBytes(source, 3), new Uint8Array([0, 255, 42]));
});

test('cancels an oversized stream instead of returning truncated bytes', async () => {
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(3));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(collectBytes(source, 2), /limit/);
  assert.equal(cancelled, true);
});

test('propagates integrity/stream failures rather than exporting partial data', async () => {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('integrity failure'));
    },
  });
  await assert.rejects(collectBytes(source, 3), /integrity failure/);
});
