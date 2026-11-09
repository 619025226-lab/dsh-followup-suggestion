import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeEntries, buildSuggestion, detectLanguage, sanitizeSuggestion } from '../lib/suggest.js';

function entry(type, data, seq, extra = {}) {
  return {
    type: 'event',
    event: { type, seq, time: seq, data, ...extra },
  };
}

function turn({ user, assistant, tools = [], reason = 'completed', assistantExtra = [] }) {
  const entries = [
    entry('turn/start', { turn: 1 }, 1),
    entry('user/message', {
      content: [{ type: 'text', text: user }],
      source: { kind: 'user' },
    }, 2),
  ];
  let seq = 3;
  for (const tool of tools) {
    entries.push(entry('tool/call', { name: tool, arguments: '{}', turn: 1, step: 1 }, seq));
    seq += 1;
  }
  for (const text of [...assistantExtra, assistant]) {
    entries.push(entry('assistant/message', {
      message: { content: [{ type: 'text', text }] },
      turn: 1,
      step: 1,
    }, seq));
    seq += 1;
  }
  entries.push(entry('turn/end', { turn: 1, reason: { kind: reason } }, seq));
  return entries;
}

test('detects Chinese content', () => {
  assert.equal(detectLanguage('帮我优化贴纸计数'), 'zh');
  assert.equal(detectLanguage('Optimize the sticker count'), 'en');
});

test('count mismatch produces a specific follow-up', () => {
  const entries = turn({
    user: '你帮我把贴纸计数再优化一下吧，第一行明明有16枚，怎么只识别出11次啊？',
    assistant: '当前识别到 11 次，可能漏掉了部分贴纸。',
  });
  const context = analyzeEntries(entries);
  assert.equal(context.countMismatch, true);
  assert.equal(context.expectedCount, 16);
  assert.equal(context.actualCount, 11);
  assert.equal(context.topic, '贴纸计数');
  const suggestion = buildSuggestion(context);
  assert.match(suggestion, /贴纸计数/u);
  assert.match(suggestion, /16/u);
  assert.match(suggestion, /11/u);
  assert.match(suggestion, /补上/u);
});

test('accepts an assistant offer', () => {
  const entries = turn({
    user: '这个贴纸识别不太准',
    assistant: '我已经把规则改好了。需要我继续优化贴纸计数吗？',
  });
  const context = analyzeEntries(entries);
  const suggestion = buildSuggestion(context);
  assert.match(suggestion, /^好，/u);
  assert.match(suggestion, /继续优化贴纸计数/u);
});

test('uses the first concrete next step', () => {
  const entries = turn({
    user: '帮我检查一下这个功能',
    assistant: '检查完成。\n\n接下来：\n1. 运行相关测试\n2. 再补一个边界用例',
  });
  const context = analyzeEntries(entries);
  const suggestion = buildSuggestion(context);
  assert.match(suggestion, /运行相关测试/u);
});

test('retries after an error turn', () => {
  const entries = turn({
    user: '把贴纸计数修一下',
    assistant: '',
    reason: 'error',
  });
  const context = analyzeEntries(entries);
  const suggestion = buildSuggestion(context);
  assert.match(suggestion, /重试/u);
});

test('suggests verification after an edit tool', () => {
  const entries = turn({
    user: '更新一下识别脚本',
    assistant: '已经修改完成。',
    tools: ['edit'],
  });
  const context = analyzeEntries(entries);
  const suggestion = buildSuggestion(context);
  assert.match(suggestion, /改动/u);
  assert.match(suggestion, /验证/u);
});

test('supports English conversations', () => {
  const entries = turn({
    user: 'Please improve the sticker counter; 16 stickers but only 11 detected.',
    assistant: 'I found the issue and updated the detector.',
    tools: ['edit'],
  });
  const context = analyzeEntries(entries);
  assert.equal(context.lang, 'en');
  const suggestion = buildSuggestion(context);
  assert.match(suggestion, /Run|Improve|Review/u);
});

test('returns null without a completed turn', () => {
  assert.equal(analyzeEntries([]), null);
  assert.equal(analyzeEntries([
    entry('turn/start', { turn: 1 }, 1),
    entry('user/message', { content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }, 2),
  ]), null);
});

test('ignores transient assistant rows', () => {
  const entries = [
    entry('turn/start', { turn: 1 }, 1),
    entry('user/message', { content: [{ type: 'text', text: '帮我优化贴纸计数' }], source: { kind: 'user' } }, 2),
    {
      type: 'transient',
      event: { type: 'assistant/message', seq: 3, time: 3, data: { message: { content: [{ type: 'text', text: '草稿' }] }, turn: 1, step: 1 } },
    },
    entry('assistant/message', { message: { content: [{ type: 'text', text: '已处理。需要我继续优化吗？' }] }, turn: 1, step: 1 }, 4),
    entry('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5),
  ];
  const context = analyzeEntries(entries);
  assert.match(buildSuggestion(context), /继续优化/u);
});

test('does not echo a question as a topic', () => {
  const entries = turn({
    user: '有输出，帮我看看会不会切到 V4-Pro',
    assistant: '会切到 V4-Pro。我刚核对过正在运行的插件，实测结果如下。',
  });
  const context = analyzeEntries(entries);
  assert.equal(context.topic, '');
  const suggestion = buildSuggestion(context);
  assert.ok(!suggestion.includes('会不会'));
  assert.ok(!suggestion.includes('帮我看看'));
});

test('does not truncate a long request into a broken topic', () => {
  const entries = turn({
    user: '能否做一个这样的插件，每次完成一次对话后，对话框就会根据实际内容出现这个指引，只要按回车就可以输入进对话框，并且可以执行起来',
    assistant: '可以，已经做成并装好了。用你截图里的贴纸场景实测，Host 模型返回的是：重新识别第一行，把漏掉的5枚贴纸也计进去。',
    tools: ['write', 'bash'],
  });
  const context = analyzeEntries(entries);
  const suggestion = buildSuggestion(context);
  assert.ok(!suggestion.includes('根据实'));
  assert.ok(!suggestion.includes('对话框就会'));
  assert.ok(suggestion.length <= 60);
  assert.ok(suggestion.includes('真实环境') || suggestion.includes('插件') || suggestion.includes('验证'));
});

test('sanitizes model output', () => {
  assert.equal(sanitizeSuggestion('  “建议：继续优化贴纸计数”  '), '继续优化贴纸计数');
  assert.equal(sanitizeSuggestion('你可以再检查一下识别结果。'), '再检查一下识别结果。');
  assert.ok(sanitizeSuggestion('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十', 20).length <= 20);
});
