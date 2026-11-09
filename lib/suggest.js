/**
 * Pure text heuristics for the composer follow-up suggestion.
 *
 * This module is intentionally free of DOM, React and Node APIs so the same
 * code can run in the browser bundle, in the Host refinement endpoint, and in
 * `node --test`.
 */

const CJK = /[\u3400-\u9fff]/u;
const SENTENCE_END = /[。！？!?；;\n]/u;

/** True when the text is (mostly) Chinese. */
export function detectLanguage(text) {
  return CJK.test(String(text ?? '')) ? 'zh' : 'en';
}

/** Join the text blocks of a Session content array. */
function textOfContent(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      parts.push(block.text.trim());
    }
  }
  return parts.join('\n').trim();
}

/** One durable event from a feed entry; transient rows are ignored. */
function durableEvent(entry) {
  if (entry === null || typeof entry !== 'object') return null;
  if (entry.type === 'transient') return null;
  return entry.event !== null && typeof entry.event === 'object' ? entry.event : null;
}

/** Read the last human text that appeared before `before`, for turns that start with context. */
function lastHumanTextBefore(events, before) {
  for (let index = before - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== 'user/message') continue;
    const kind = event.data?.source?.kind;
    if (kind !== undefined && kind !== 'user') continue;
    const text = textOfContent(event.data?.content);
    if (text !== '') return text;
  }
  return '';
}

/** Extract quantity readings such as "16 枚" or "11 times". */
function extractCounts(text) {
  const source = String(text ?? '');
  const counts = [];
  const pattern = /(\d+(?:\.\d+)?)\s*(枚|个|次|张|条|块|颗|份|页|帧|位|处|项|行|列|%|items?|times?|rows?|columns?|pieces?|photos?|images?)/giu;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    counts.push({ value, unit: match[2] });
  }
  return counts;
}

const LOCATION_UNITS = new Set(['行', '列', 'rows', 'row', 'columns', 'column']);

/** Pick the most useful count from a list. */
function usefulCount(counts, fallback = null) {
  for (const count of counts) {
    if (!LOCATION_UNITS.has(count.unit.toLowerCase())) return count;
  }
  return counts[0] ?? fallback;
}

/** Remove decoration that would look odd inside a one-line composer hint. */
function cleanText(text) {
  return String(text ?? '')
    .replace(/\r/gu, '')
    .replace(/[*_`#>]/gu, '')
    .replace(/^[\s"'“”‘’「」『』【】()（）[\]<>]+|[\s"'“”‘’「」『』【】()（）[\]<>]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Whether a candidate topic is specific enough to use. */
function usefulTopic(topic) {
  if (typeof topic !== 'string') return false;
  const text = topic.trim();
  if (text.length < 2 || text.length > 28) return false;
  if (/^(?:这个|那个|一下|看看|问题|东西|功能|内容|结果|情况|任务|操作|部分|地方|方面|方式|方法|方案|代码|文件|插件|它们?|这些|那些)$/u.test(text)) return false;
  if (/^(?:出|了|的|得|地|和|与|或|而|但|就|还|也|都|被|把|将)/u.test(text)) return false;
  if (/[？?！!。；;，,、\n]/u.test(text)) return false;
  if (/^(?:这样的|那样的|这种|那种|一个|这个|那个|这些|那些)/u.test(text)) return false;
  if (/(?:怎么|为什么|是不是|会不会|能不能|可不可以|有没有|是否|要不要|该不该|如何|多少|哪一?个|哪些|帮我|请你|麻烦)/u.test(text)) return false;
  if (/^[\d.\s%]+$/u.test(text)) return false;
  return true;
}

/** Normalize the object of a request into a short noun phrase. */
function cleanTopic(topic) {
  let text = cleanText(topic);
  text = text.replace(/^(?:把|将|给|对|关于|这个|那个|这些|那些|这样的|那样的|这种|那种|其|一下|下)\s*/u, '');
  text = text.replace(/^(?:再|重新|继续|好好|认真|仔细)\s*/u, '');
  text = text.replace(/\s*(?:对不对|是不是|行不行|好不好|可以吗|怎么样|对吗|不对|对|错|准)$/u, '');
  text = text.replace(/\s*(?:吧|呢|吗|啊|呀|呗|哦|一下|下|了|的|再)$/u, '');
  text = text.replace(/\s*(?:不太|不够|比较|有点|有些|很|太)(?:准|好|对|行|理想|准确|稳定|满意).*$/u, '').trim();
  text = text.replace(/\s+/gu, ' ').trim();
  return text;
}

/**
 * Find the object and verb of the user's latest request.
 * @returns {{topic: string, verb: string} | null}
 */
function extractTopic(text) {
  const raw = String(text ?? '').trim();
  if (raw === '') return null;
  const first = raw.split(SENTENCE_END)[0].trim();
  let working = first.replace(
    /^(?:你|您)?(?:帮我|帮忙|麻烦你?|请|我想|我要|能不能|可不可以|能否|可以)+/u,
    '',
  ).trim();

  const patterns = [
    {
      re: /把\s*([^，,。！？!?；;\n]{2,32}?)\s*(?:再|重新|继续|好好)?\s*(优化|改进|修复|调整|完善|检查|分析|统计|识别|处理|更新|添加|增加|删除|移除|修改|重构|整理|排查|定位|做|改|弄|修|看|查)(?:\s*(?:一下|下|一遍|看))?/u,
      topic: 1,
      verb: 2,
    },
    {
      re: /^(优化|改进|修复|调整|完善|检查|分析|统计|识别|处理|更新|添加|增加|删除|移除|修改|重构|整理|排查|定位|实现|设计|开发|写|做|生成|修)\s*(?:一下|下|一个|个|一遍)?\s*([^，,。！？!?；;\n]{2,32})/u,
      topic: 2,
      verb: 1,
    },
  ];
  for (const pattern of patterns) {
    const match = working.match(pattern.re);
    if (match === null) continue;
    const topic = cleanTopic(match[pattern.topic]);
    const verb = match[pattern.verb];
    if (usefulTopic(topic)) return { topic, verb };
  }

  let fallback = working.replace(/^(?:把|将|给|对|关于)/u, '').trim();
  fallback = fallback.replace(/^(?:再|重新|继续|好好|认真|仔细)/u, '').trim();
  fallback = fallback.replace(
    /^(?:优化|改进|修复|调整|完善|检查|分析|统计|识别|处理|更新|添加|增加|删除|移除|修改|重构|整理|排查|定位|实现|设计|开发|写|做|生成|修)(?:一下|下|一个|个)?/u,
    '',
  ).trim();
  fallback = cleanTopic(fallback);
  return usefulTopic(fallback) ? { topic: fallback, verb: '' } : null;
}

/** Find the offer at the end of an assistant reply, e.g. "需要我继续优化吗？". */
function extractOffer(text) {
  const tail = cleanText(String(text ?? '').slice(-220));
  if (tail === '') return null;
  const pattern = /(?:需不需要|要不要|需要我|要我|我可以|我帮你|我可以帮你|建议(?:你)?|可以(?:帮你)?)\s*([^。！？!?；;\n]{2,48})[吗呢？?]?\s*[。！？!?]?\s*$/u;
  const match = tail.match(pattern);
  if (match === null) return null;
  let action = match[1].trim();
  action = action.replace(/^(?:帮你|为你|来|直接|先|一起)\s*/u, '');
  action = action.replace(/^我\s*/u, '');
  action = action.replace(/^你\s*/u, '我');
  action = action.replace(/[吗呢？?。！!]+$/u, '').trim();
  if (action.length < 2) return null;
  return action.slice(0, 40);
}

/** Find the first concrete step under a "next" heading. */
function extractNextStep(text) {
  const lines = String(text ?? '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = line.match(/(?:下一步|接下来|建议(?:你)?|后续(?:可以)?|你可以(?:先)?)[：:]\s*(.+)$/u);
    if (heading !== null) {
      const item = cleanStep(heading[1]);
      if (item !== null) return item;
    }
    if (!/(?:下一步|接下来|建议(?:你)?|后续(?:可以)?|你可以(?:先)?)[：:]?$/u.test(line)) continue;
    for (let next = index + 1; next < Math.min(lines.length, index + 4); next += 1) {
      const match = lines[next].match(/^(?:\d+[.、)]|[-*•])\s+(.+)$/u);
      if (match === null) continue;
      const item = cleanStep(match[1]);
      if (item !== null) return item;
    }
  }
  return null;
}

/** Normalize one step for a user-voiced suggestion. */
function cleanStep(text) {
  let step = cleanText(text);
  step = step.replace(/^(?:你|您)(?:可以|应该|需要|先)?\s*/u, '');
  step = step.replace(/^(?:我建议|建议)\s*/u, '');
  step = step.replace(/[。；;]+$/u, '').trim();
  if (step.length < 2) return null;
  return step.slice(0, 42);
}

/** Prefix a step so it reads as a user instruction. */
function instructionForStep(step) {
  return /^(?:先|再|继续|把|将|给|用|运行|检查|确认|补|修|加|删|改|写|做|生成|执行|测试|验证|重新|尝试|打开|关闭)/u.test(step)
    ? step
    : `先${step}`;
}

/** Whether a string contains one of the given words. */
function hasWord(text, words) {
  return words.some((word) => text.includes(word));
}

/** Extract the final sentence of an assistant reply. */
function finalSentence(text) {
  const normalized = String(text ?? '').trim();
  if (normalized === '') return '';
  const parts = normalized.split(/(?<=[。！？!?])/u).map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) ?? normalized;
}

/**
 * Analyze one Session event window.
 * @param {readonly unknown[]} entries - Session event feed entries.
 * @param {{maxChars?: number}} [options]
 * @returns {object | null} A turn context, or null when no completed turn exists.
 */
export function analyzeEntries(entries, options = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const events = [];
  for (const entry of entries) {
    const event = durableEvent(entry);
    if (event !== null) events.push(event);
  }
  if (events.length === 0) return null;

  let endIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === 'turn/end') {
      endIndex = index;
      break;
    }
  }
  if (endIndex < 0) return null;

  let startIndex = -1;
  for (let index = endIndex - 1; index >= 0; index -= 1) {
    if (events[index].type === 'turn/start') {
      startIndex = index;
      break;
    }
  }
  let from = startIndex;
  if (from < 0) {
    from = 0;
    for (let index = endIndex - 1; index >= 0; index -= 1) {
      if (events[index].type === 'turn/end') {
        from = index + 1;
        break;
      }
    }
  }

  const userTexts = [];
  const assistantTexts = [];
  const tools = [];
  const toolArguments = [];
  let deliverablesPresented = false;
  let goalCompleted = false;
  for (let index = from; index <= endIndex; index += 1) {
    const event = events[index];
    if (event.type === 'user/message') {
      const kind = event.data?.source?.kind;
      if (kind !== undefined && kind !== 'user') continue;
      const text = textOfContent(event.data?.content);
      if (text !== '') userTexts.push(text);
      continue;
    }
    if (event.type === 'assistant/message') {
      const text = textOfContent(event.data?.message?.content);
      if (text !== '') assistantTexts.push(text);
      continue;
    }
    if (event.type === 'tool/call') {
      if (typeof event.data?.name === 'string') tools.push(event.data.name);
      if (typeof event.data?.arguments === 'string') toolArguments.push(event.data.arguments);
      continue;
    }
    if (event.type === 'deliverables/presented') {
      deliverablesPresented = true;
      continue;
    }
    if (event.type === 'goal/change') {
      const data = event.data;
      if (data?.phase === 'completed' || data?.goal?.phase === 'completed' || data?.kind === 'completed' || data?.state === 'done') goalCompleted = true;
    }
  }

  const end = events[endIndex];
  const reason = end.data?.reason?.kind ?? 'completed';
  const lastUserText = userTexts.at(-1) ?? lastHumanTextBefore(events, from);
  const assistantText = assistantTexts.at(-1) ?? '';
  const assistantAll = assistantTexts.join('\n');
  const toolText = `${tools.join(' ')}\n${toolArguments.join('\n')}`;
  const lang = detectLanguage(`${lastUserText}\n${assistantText}`);

  if (lastUserText === '' && assistantText === '' && tools.length === 0) return null;

  const topicInfo = extractTopic(lastUserText);
  const offer = extractOffer(assistantText);
  const nextStep = extractNextStep(assistantText);
  const question = /[？?]\s*$/u.test(assistantText.trim());

  const userCounts = extractCounts(lastUserText);
  const assistantCounts = extractCounts(assistantText);
  const expected = usefulCount(userCounts, null);
  const actual = usefulCount(assistantCounts, null) ?? usefulCount(userCounts.slice(1), null);
  const countMismatch = expected !== null && actual !== null && expected.value !== actual.value
    && expected.value > actual.value;

  const lowerTools = tools.map((name) => name.toLowerCase());
  const hasEditTool = lowerTools.some((name) => /write|edit|patch|apply|create_file|str_replace|notebook_edit/u.test(name));
  const hasTestTool = lowerTools.some((name) => /test|pytest|vitest|jest|playwright|cypress/u.test(name))
    || /(?:pytest|vitest|jest|playwright|npm test|pnpm test|yarn test|go test|cargo test)/iu.test(toolText);
  const userImage = /(?:图片|截图|贴纸|照片|图像|image|photo|picture|vision|ocr)/iu.test(lastUserText)
    && /(?:识别|检测|计数|数量|漏|标注|框选|看|分析|处理|优化|检查)/u.test(lastUserText);
  const hasImage = userImage;
  const mentionsTest = /(?:测试|验证|运行|跑一遍|构建|编译|test|verify|run|build|compile)/iu.test(`${assistantAll}\n${lastUserText}`);
  const mentionsPass = /(?:通过|成功|已通过|passed|passing|all tests pass|no errors)/iu.test(assistantAll);
  const reasonNormalized = reason === 'error' ? 'error' : reason === 'aborted' || reason === 'interrupted' ? 'aborted' : 'completed';
  const greeting = /^(?:hi|hello|hey|你好|您好|在吗|谢谢|thanks|thank you|早上好|晚上好)[!！。.\s]*$/iu.test(lastUserText.trim());
  const trivial = greeting && offer === null && nextStep === null && tools.length === 0 && assistantText.length < 200;

  return {
    key: String(end.seq ?? endIndex),
    lang,
    reason: reasonNormalized,
    lastUserText,
    assistantText,
    assistantAll,
    tools,
    toolText,
    topic: topicInfo?.topic ?? '',
    verb: topicInfo?.verb ?? '',
    offer,
    nextStep,
    question,
    hasEditTool,
    hasTestTool,
    hasImage,
    mentionsTest,
    mentionsPass,
    countMismatch: Boolean(countMismatch),
    done: deliverablesPresented || goalCompleted,
    expectedCount: expected?.value,
    expectedUnit: expected?.unit,
    actualCount: actual?.value,
    actualUnit: actual?.unit,
    variant: Math.abs(Number(end.seq ?? 0)) % 3,
    trivial,
    maxChars: options.maxChars ?? 60,
  };
}

/** Chinese templates. */
function buildChinese(context) {
  const topic = context.topic || '刚才的结果';
  const final = finalSentence(context.assistantText);

  if (context.reason === 'error' || context.reason === 'aborted') {
    return context.topic
      ? `重试一下${context.topic}，先看看刚才为什么没成功`
      : '重试刚才的操作，先看看失败原因';
  }
  if (context.offer !== null) {
    return `好，${context.offer}`;
  }
  if (context.nextStep !== null) {
    return instructionForStep(context.nextStep);
  }
  if (context.countMismatch) {
    const expected = `${context.expectedCount}${context.expectedUnit ?? ''}`;
    const actual = `${context.actualCount}${context.actualUnit ?? ''}`;
    return `再优化一下${topic}，${expected}里只识别出${actual}，把漏掉的补上`;
  }
  if (context.hasEditTool && !context.hasTestTool && !context.mentionsPass) {
    return '把刚才的改动跑一遍验证，有问题直接修';
  }
  if (context.mentionsTest && !context.mentionsPass) {
    const shortTopic = context.topic.length <= 16 ? context.topic : '';
    return shortTopic !== ''
      ? `跑一下相关测试，确认${shortTopic}没有回归`
      : '跑一下相关测试，确认没有回归';
  }
  if (context.hasImage) {
    return context.topic
      ? `再检查一遍${context.topic}，把漏掉的部分补上`
      : '再核对一遍识别结果，把漏掉的补上';
  }
  if (context.verb === '修复') {
    return `确认${topic}已经修好，再补一个回归测试`;
  }
  if (context.verb === '检查' || context.verb === '分析') {
    return `再深入检查${topic}，把发现的问题直接修掉`;
  }
  if (context.question) {
    return /建议|方案|思路/u.test(context.assistantText)
      ? '按你建议的方案来'
      : '按你的思路继续';
  }
  if (context.topic) {
    const variants = [
      `再优化一下${topic}，先处理还没覆盖到的情况`,
      `继续完善${topic}，把边界情况也考虑进去`,
      `把${topic}再检查一遍，有问题直接改`,
    ];
    return variants[context.variant % variants.length];
  }
  if (/(?:识别|统计|计数|数量)/u.test(context.lastUserText)) {
    return '再核对一遍数量和识别结果，把漏掉的补上';
  }
  if (/(?:插件|客户端|输入框|对话框|界面)/u.test(`${context.lastUserText}\n${context.assistantText}`)) {
    return '在真实环境里试一遍，把漏掉的场景补上';
  }
  if (/(?:代码|文件|脚本|实现)/u.test(context.lastUserText)) {
    return '把刚才的改动运行验证一下，报错就直接修';
  }
  if (final !== '' && /建议|方案|思路/u.test(final)) {
    return '按你建议的方案继续';
  }
  const generic = [
    '继续优化刚才的结果，先列出还能改进的地方',
    '把刚才的结果再检查一遍，有问题直接修',
    '基于刚才的结果继续，先做最关键的一步',
  ];
  return generic[context.variant % generic.length];
}

/** English templates. */
function buildEnglish(context) {
  const topic = context.topic || 'the last result';
  if (context.reason === 'error' || context.reason === 'aborted') {
    return 'Retry the last step and check what went wrong';
  }
  if (context.offer !== null) {
    return `Yes, ${context.offer}`;
  }
  if (context.nextStep !== null) {
    return /^(?:start|run|check|verify|fix|add|remove|update|write|create|test|try|open|continue)/iu.test(context.nextStep)
      ? context.nextStep
      : `Start by ${context.nextStep}`;
  }
  if (context.countMismatch) {
    const expected = `${context.expectedCount}${context.expectedUnit ?? ''}`;
    const actual = `${context.actualCount}${context.actualUnit ?? ''}`;
    return `Improve ${topic} again: only ${actual} of ${expected} were counted, so fill in the missing ones`;
  }
  if (context.hasEditTool && !context.hasTestTool && !context.mentionsPass) {
    return 'Run the recent changes and fix anything that breaks';
  }
  if (context.mentionsTest && !context.mentionsPass) {
    return `Run the relevant tests to confirm ${topic} still works`;
  }
  if (context.hasImage) {
    return context.topic
      ? `Check ${context.topic} again and fill in anything missed`
      : 'Check the recognition result again and fill in anything missed';
  }
  if (context.verb === '修复') {
    return `Confirm ${topic} is fixed and add a regression test`;
  }
  if (context.verb === '检查' || context.verb === '分析') {
    return `Inspect ${topic} more deeply and fix what you find`;
  }
  if (context.question) {
    return /suggest|plan|approach/iu.test(context.assistantText)
      ? 'Go with the plan you suggested'
      : 'Continue with your approach';
  }
  if (context.topic) {
    const variants = [
      `Improve ${topic} further and handle what is still missing`,
      `Continue refining ${topic} and cover the edge cases`,
      `Review ${topic} again and fix anything that looks wrong`,
    ];
    return variants[context.variant % variants.length];
  }
  const generic = [
    'Continue improving the last result and list what still needs work',
    'Review the last result again and fix anything that is wrong',
  ];
  return generic[context.variant % generic.length];
}

/**
 * Turn a context into one short composer instruction.
 * @param {object} context - Result of {@link analyzeEntries}.
 * @param {{maxChars?: number}} [options]
 * @returns {string}
 */
export function buildSuggestion(context, options = {}) {
  if (context === null || typeof context !== 'object') return '';
  if (context.trivial === true) return '';
  const suppress = options.suppressOnComplete !== false;
  if (suppress && context.done === true && context.offer === null && context.nextStep === null && context.question !== true && context.countMismatch !== true) {
    return '';
  }
  const text = context.lang === 'en' ? buildEnglish(context) : buildChinese(context);
  return sanitizeSuggestion(text, options.maxChars ?? context.maxChars ?? 60);
}

/**
 * Trim model output to one clean line that can sit in the composer.
 * @param {string} text - Raw suggestion.
 * @param {number} maxChars - Hard limit.
 * @returns {string}
 */
export function sanitizeSuggestion(text, maxChars = 60) {
  let value = String(text ?? '')
    .replace(/\r/gu, '')
    .replace(/^```[a-z]*\s*/iu, '')
    .replace(/```$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
  value = value.replace(/^["'“”‘’「」『』]+|["'“”‘’「」『』]+$/gu, '').trim();
  value = value.replace(/^(?:建议(?:你)?|提示|suggestion|next)\s*[：:]\s*/iu, '').trim();
  value = value.replace(/^["'“”‘’「」『』]+|["'“”‘’「」『』]+$/gu, '').trim();
  value = value.replace(/^(?:你可以|您可以|你可以试试|建议你)\s*/u, '').trim();
  if (value === '') return '';
  const limit = Math.max(12, Math.min(160, Number(maxChars) || 60));
  if (value.length <= limit) return value;
  const window = value.slice(0, limit + 1);
  const cut = Math.max(
    window.lastIndexOf('，'),
    window.lastIndexOf('。'),
    window.lastIndexOf('；'),
    window.lastIndexOf(','),
    window.lastIndexOf('. '),
    window.lastIndexOf(' '),
  );
  if (cut >= Math.floor(limit * 0.45)) return window.slice(0, cut).trim();
  return window.slice(0, limit).trim();
}
