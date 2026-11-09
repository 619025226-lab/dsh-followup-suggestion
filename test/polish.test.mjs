import test from 'node:test';
import assert from 'node:assert/strict';

import { resolvePolishStyle, sanitizePolished } from '../lib/index.js';

test('strips a model-added code fence around a plain draft', () => {
  assert.equal(sanitizePolished('```text\n你好，世界。\n```', '你好，世界。'), '你好，世界。');
});

test('keeps a fence the user actually wrote', () => {
  const draft = '```js\nconst x = 1;\n```';
  assert.equal(sanitizePolished(draft, draft), draft);
});

test('strips common polish prefixes', () => {
  assert.equal(sanitizePolished('润色后：\n你好。', '你好。'), '你好。');
  assert.equal(sanitizePolished('以下是润色后的文字：\n你好。', '你好。'), '你好。');
});

test('strips wrapping quotes only when the draft was not quoted', () => {
  assert.equal(sanitizePolished('“你好。”', '你好。'), '你好。');
  assert.equal(sanitizePolished('“你好。”', '“你好。”'), '“你好。”');
});

test('preserves newlines and markdown', () => {
  const draft = '## 标题\n\n- 一\n- 二';
  assert.equal(sanitizePolished(draft, draft), draft);
});

test('returns an empty string for an empty model answer', () => {
  assert.equal(sanitizePolished('   ', '你好'), '');
});


test('resolves a known style to its localized description', () => {
  const style = resolvePolishStyle('concise', 'zh');
  assert.equal(style.id, 'concise');
  assert.match(style.text, /简洁/u);
});

test('passes a custom style through and clips it', () => {
  const style = resolvePolishStyle('  更温柔，像给同事发消息  ', 'zh');
  assert.equal(style.id, '更温柔，像给同事发消息');
  assert.equal(style.text, '更温柔，像给同事发消息');
  assert.equal(resolvePolishStyle('x'.repeat(120), 'en').text.length, 80);
});
