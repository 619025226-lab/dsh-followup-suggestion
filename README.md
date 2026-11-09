# dsh-followup-suggestion

在 DeepSeek Harness 的输入框里，**每轮对话结束后自动出现一句根据刚才内容生成的「下一句」**。它显示为输入框里的灰色提示文字；输入框为空时按 **Enter** 就会采纳并直接发送，按 **Esc** 忽略，输入任意字符也会让它消失。

输入框里已经有文字时，工具栏会出现 **「✦ 润色」**：选风格、预览、替换草稿或撤销，只改草稿，不会发送。

![输入框中的下一句提示](preview.png)

```
┌──────────────────────────────────────────────────────┐
│ 再优化一下贴纸计数，16枚里只识别出11次，把漏掉的补上   │
│                                                      │
│ +   完全访问                         GPT-...   🎙  ➤ │
└──────────────────────────────────────────────────────┘
```

## 它怎么决定这句话

每次 `turn/end` 之后读取当前会话的持久事件，只取这一轮：

- 最后一条人类消息、助手最后的文字、调用过的工具、结束状态（完成 / 失败 / 中断）；
- 识别助手结尾的提议（「需要我继续优化吗？」）、「下一步」列表、数量差异（16 枚 vs 11 次）、编辑类工具、测试上下文、图片/识别上下文；
- 先生成一句本地启发式建议，立即显示；
- 如果 Host 端可用且配置允许，再异步请求一次默认模型，把这句话改得更贴合上下文（通常比本地句更自然）。模型失败、超时或没有可用模型时，保留本地句，不影响使用。

本地句不联网、不花钱；智能句只发送这一轮的简短摘录给当前部署的模型，不写磁盘，也不上传到第三方。

如果这一轮**已经达成用户目标**——例如展示了最终交付文件、goal 标记为完成——并且没有新的问题、提议或下一步，默认**不再显示提示**，避免「已经做完了还问继续」的冗余。想恢复「每轮结束都提示」，把 `suppressOnComplete` 设为 `false`。

## 润色输入框草稿

![草稿润色面板](preview-polish.png)

输入框里有文字时，`+` / 权限旁边会出现「✦ 润色」。点击它、在输入框里**右键**，或按 **Cmd/Ctrl+Shift+P**，打开润色面板：

1. 选风格：**自然 / 简洁 / 专业 / 口语 / 自定义**；
   - 选「自定义」后可以输入自己的要求，例如「更温柔」「像给同事发消息」「更学术」；
2. 点「开始润色」，Host 调用默认模型，结果先进入预览；
3. 点「替换草稿」只替换输入框内容，**不会发送**；
4. 替换后可点「撤销」恢复原文；点「重新润色」可换风格重试。

润色只在**纯文本草稿**上出现：带文件/会话引用、斜杠命令、空草稿或只有空白字符时不显示。带附件但文字正常的草稿仍可润色；润色只处理文字。

## 安装

```sh
cd ~/Documents/deepseek-harness/对话插件开发/dsh-followup-suggestion
node build.mjs          # 改动 lib/client.template.js 或 lib/suggest.js 后需要重新生成 lib/client.js
./install.sh
```

然后**完全退出并重新打开 DeepSeek Harness**。如果 Host 开着 HMR，通常刷新页面（Cmd+R）或等它自动重组即可；没有 HMR 时重启应用。

脚本会：

1. 把插件复制到 `~/.dsh/plugins/dsh-followup-suggestion`；
2. 在 profile 的 `package.json` 里声明 `link:` 依赖，并建立 `node_modules` 符号链接；
3. 在 profile 的 `cordis.patch.yml` 中追加 `followup-suggestion` 的加载项。

也可以用插件管理页/`plugin_manager` 把本目录作为本地 bundle 安装（本包自带 `cordis.patch.yml`）。**两种方式二选一**，不要同时使用，否则同一个 row 会插入两次。

卸载：

```sh
./uninstall.sh
```

再重启应用。

## 交互

| 操作 | 结果 |
| --- | --- |
| 输入框为空时按 **Enter** | 采纳提示并发送（默认 `accept: send`） |
| 输入框为空时按 **Esc** | 忽略这一轮的提示，下一轮结束再出现 |
| 开始输入任意字符 | 提示自动隐藏，不会干扰正常草稿 |
| 输入框有文字时点「✦ 润色」 | 打开风格选择与预览面板，只改草稿 |
| 输入框有文字时右键 | 菜单里出现「润色这段草稿」，选择后打开同一面板 |
| 输入框有文字时按 **Cmd/Ctrl+Shift+P** | 快速打开/关闭润色面板 |
| 流式运行 / 等待审批 / 有附件 / 已有草稿 | 不显示提示 |
| 切换会话 | 根据该会话最后一轮重新生成 |
| 刷新页面 | 根据持久事件重新生成 |

提示只出现在**主会话**；子会话、空会话和已归档/移除的会话不显示。

## 配置

在 profile 的 `cordis.patch.yml` 里给 `followup-suggestion` 条目加 `config`：

```yaml
- id: followup-suggestion
  name: dsh-followup-suggestion
  config:
    mode: auto          # auto | heuristic | llm | off
    accept: send        # send：Enter 采纳并发送；fill：只填入草稿，再按一次 Enter 发送
    maxChars: 60        # 提示最大字符数
    llmTimeoutMs: 6000  # 智能句超时，超时后保留本地句
    reasoningEffort: off # 智能句/润色推理强度；默认 off，最快也最便宜
    polish: true        # 是否显示输入框「润色」入口
    polishMaxChars: 4000 # 单次可润色的草稿上限
    polishTimeoutMs: 15000 # 润色超时
    suppressOnComplete: true # 目标已达成时抑制「下一句」提示；false 则每轮都提示
    # provider: deepseek-account   # 可选，默认跟随当前默认模型
    # model: deepseek-flash        # 可选
```

- `auto`（默认）：先显示本地句，再异步用模型润色；
- `heuristic`：只用本地规则，不调用模型；
- `llm`：优先模型（失败仍回退本地规则）；
- `off`：关闭提示。

`accept: send` 时，一次 Enter 会同时填入并发送；`accept: fill` 时只填入输入框，让你可以先改，再按 Enter 发送。建议先试用默认值；如果不想为「下一句」产生额外模型调用，改成 `mode: heuristic`；`polish` 是独立开关，设为 `false` 只关闭草稿润色。

## 实现结构

```
dsh-followup-suggestion/
  package.json          # dsh.client 声明 + 入口
  cordis.patch.yml      # 作为 bundle 使用时的加载项
  build.mjs             # 把 lib/suggest.js 内联进 lib/client.js
  lib/suggest.js        # 纯文本启发式：事件分析、主题/数量/提议/下一步提取
  lib/client.template.js# 浏览器半：事件订阅、原生 placeholder、Enter 快捷键、草稿润色面板
  lib/client.js         # 构建产物（真正被加载的 bundle）
  lib/index.js          # Host 半：/config、/suggest、/polish，模型调用与缓存
  test/suggest.test.mjs # 下一句启发式单元测试
  test/polish.test.mjs  # 润色输出清洗单元测试
  install.sh / uninstall.sh
```

浏览器半没有额外 npm 依赖，只使用平台自带的 `react`。它把提示写进 composer 自带的 `[data-composer-placeholder]` 节点，所以位置、换行、省略号、输入法组合期间隐藏等行为与原生 placeholder 完全一致；不新增浮层，也不改输入框 DOM 结构。

快捷键在 composer 卡片的捕获阶段监听，只在输入框获得焦点、草稿为空、提示可见时拦截 Enter/Esc；其他按键、Shift+Enter、Cmd/Ctrl+Enter 以及输入法组合状态都原样放行。

## 排错

- **看不到提示**：确认会话已经至少完成一轮；确认输入框为空；确认插件 row 已加载（设置 → 插件列表或插件管理页）。改完代码后先 `node build.mjs`，再重新安装/刷新。
- **提示出现了但 Enter 没反应**：确认焦点在输入框内（不是发送按钮或模型选择器）；确认没有按住 Shift/Cmd/Ctrl/Alt；确认输入法没有处于组合状态。
- **智能句一直是本地句**：说明 Host `/suggest` 不可用，可能是插件 Host 半没加载、没有默认模型，或模型调用失败。看应用日志里 `[followup-suggestion]` 开头的行；也可以把 `mode` 设为 `heuristic` 避免等待。
- **每次刷新都调用模型**：Host 按「会话 + turn/end seq」缓存 10 分钟；同一轮不会重复计费。不同轮次本来就会各调用一次。
- **看不到「润色」按钮**：确认输入框里有纯文本且没有引用/斜杠命令；确认 Host 已加载 0.2.0（`/config` 返回 `polish: true`、`capabilities.polish: true`）；刷新页面。
- **润色失败**：多数是 Host 模型调用失败或超时；检查默认模型是否可用，或调大 `polishTimeoutMs`。`/config` 里 `llm`/`polish` 为 `false` 时按钮不会出现。
- **撤销不可用**：撤销只在润色结果面板还开着时可用；关闭面板或继续输入后，草稿已是你确认过的内容。
- **不想要这个功能**：把 `mode` 设为 `off`，或停用/卸载插件。

## 限制

- 提示质量取决于最近一轮的文字和工具名；如果助手只调用了工具、没有文字，可能生成较通用的句子。
- 智能句需要当前 profile 有可用的默认模型；没有时自动退回本地句。
- 只在 composer 为空时出现；不会覆盖你正在写的草稿。
- 不读取、不上传历史中的图片内容，只根据文字与工具名判断。


## 修复记录

- **0.3.1**：目标已达成（展示交付文件 / goal 完成）且没有新问题或下一步时，默认不再显示「下一句」提示；`suppressOnComplete: false` 可恢复每轮提示。
- **0.3.0**：右键菜单加入「润色这段草稿」；风格增加「自定义」，可输入任意风格要求（如更温柔、像同事消息、更学术）。
- **0.2.0**：新增输入框草稿润色：工具栏「✦ 润色」、四种风格、预览、替换、撤销、Cmd/Ctrl+Shift+P 快捷键；Host 新增 `/polish`，与下一句建议相互独立。只处理纯文本草稿，不发送、不改历史消息。
- **0.1.1**：长请求不再把第一个分句硬截断成半句（之前会生成「……根据实，把漏掉的部分补上」这种断句）；图片/识别分支只读取用户自己的请求，避免把助手回答里的「截图 / 贴纸」示例误判成当前任务；Host 增加能力声明，旧 Host 没有推理控制时客户端只使用本地句，避免空回答；Host 模型调用固定 `reasoningEffort: off`，一句话生成更快更稳。
- 新增回归测试：长请求不会产生半句或回显残句。
