import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeEntries, buildSuggestion } from '../lib/suggest.js';

function entry(type, data, seq) {
  return { type: 'event', event: { type, seq, time: seq, data } };
}

function turnWithDeliverables({ assistant, files }) {
  return [
    entry('turn/start', { turn: 1 }, 1),
    entry('user/message', { content: [{ type: 'text', text: '帮我整理一份周报' }], source: { kind: 'user' } }, 2),
    entry('assistant/message', { message: { content: [{ type: 'text', text: assistant }] }, turn: 1, step: 1 }, 3),
    entry('deliverables/presented', { turn: 1, callId: 'call_deliver', files }, 4),
    entry('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5),
  ];
}

test('regression: delivering files suppresses the follow-up hint', () => {
  const entries = turnWithDeliverables({
    assistant: '已完成，周报文件已经交付。',
    files: [{ path: '/tmp/周报.md', description: '周报' }],
  });
  const context = analyzeEntries(entries);
  assert.equal(context.done, true);
  assert.equal(buildSuggestion(context), '');
  assert.notEqual(buildSuggestion(context, { suppressOnComplete: false }), '');
});

test('delivered files do not suppress the hint when a follow-up offer exists', () => {
  const entries = turnWithDeliverables({
    assistant: '已完成。需要我再补一份月报吗？',
    files: [{ path: '/tmp/周报.md' }],
  });
  const context = analyzeEntries(entries);
  assert.equal(context.done, true);
  assert.notEqual(buildSuggestion(context), '');
});

test('a completed goal also suppresses the hint', () => {
  const entries = [
    entry('turn/start', { turn: 1 }, 1),
    entry('user/message', { content: [{ type: 'text', text: '把这个任务做完' }], source: { kind: 'user' } }, 2),
    entry('assistant/message', { message: { content: [{ type: 'text', text: '全部完成。' }] }, turn: 1, step: 1 }, 3),
    entry('goal/change', { phase: 'completed' }, 4),
    entry('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5),
  ];
  const context = analyzeEntries(entries);
  assert.equal(context.done, true);
  assert.equal(buildSuggestion(context), '');
});
