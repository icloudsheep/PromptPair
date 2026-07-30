# PromptPair

PromptPair 是一个配置驱动的 Prompt 积木工作台。它将角色、前端、后端、代码规范和知识库等 Prompt 片段组合成配方，并通过 OpenAI 或 Anthropic 兼容接口生成最终 Prompt。

## 启动

项目只依赖 Python 3.9+ 标准库。

```bash
cp .env.example .env
python3 main.py
```

编辑 `.env`，填入模型地址、密钥和模型名称，然后访问 `http://127.0.0.1:8001`。API Key 仅由 Python 服务端读取，不会发送给浏览器。`LLM_API_BASE` 支持 OpenAI 兼容的 `/v1` 基址或完整 `/chat/completions` 地址；以 `/anthropic` 结尾的基址及完整 `/v1/messages` 地址会自动使用 Anthropic 兼容协议。`LLM_MAX_TOKENS` 用于 Anthropic 兼容请求，默认值为 4096。

## 配置结构

```text
assets/
  config/app.json       应用入口配置
  i18n/zh-CN.json       全部界面文案
  prompts/manifest.json Prompt 分类清单
  prompts/*.json        分类和 Prompt 积木
scripts/
  core/                 状态等基础能力
  modules/              可插拔界面功能
  services/             配置和 API 访问
  utils/                通用工具
themes/
  base.css              结构与组件样式
  light.css             浅色主题变量
  dark.css              深色主题变量
```

## Prompt 配置

在 `assets/prompts/` 新建一个结构与现有文件相同的 JSON 文件，再在 `manifest.json` 的 `categories` 中添加文件路径和颜色。刷新页面即可加载，无需修改 JavaScript。

每块 Prompt 必须包含 `type`、`id`、`name`、`summary`、`icon` 和 `prompt`。`type` 可取：

- `role`：角色积木。画布会将所有角色融合到同一个中空外层容器中。
- `instruction`：需要角色执行的具体指令。
- `context`：任务背景、资料和知识上下文。
- `constraint`：不能违反的边界或实现约束。
- `quality`：质量目标、检查和验收要求。

非角色积木会显示在角色容器内部。选择多个角色不会互相替换；生成时，服务端会要求模型将其融合为一个兼具多个视角的复合角色。

## 设置与语言

顶部设置按钮打开独立设置页。常规设置可以切换语言；积木设置按“分类 → 积木 → 编辑表单”分层展示全部配置。表单编辑经过 500 ms 防抖后自动写回对应 JSON，保存成功后积木库立即更新；画布中未手动修改的实例同步源配置，已经手动改写的正文会保留。

新增语言时，复制一份 `assets/i18n/*.json`，并在 `assets/config/app.json` 的 `locales` 中登记 `id`、显示名称和文件路径。所有正常界面文案均来自这些可直接阅读的 JSON 文件；配置本身无法加载时的最后回退提示保存在 `index.html`。

设置接口只允许写入受 `assets/prompts/manifest.json` 管理的 Prompt JSON 和 `assets/config/app.json` 中已登记的语言，不读取或返回 `.env`。

## 分享格式

点击“分享配方”会打开配方代码输入框，不会修改页面地址。配方代码是人类可读的 JSON，只记录积木的分类 ID 和积木 ID；只有正文被手动改写时才附带完整正文。复制代码即可分享，粘贴代码并点击“应用配方”即可恢复工作台。

项目尚未上线，因此只支持当前 `version: 1` 配方代码，不读取旧 URL hash 或历史分享格式。

## 工作台渲染

工作台为每个积木实例保留独立 DOM 节点。添加、删除和排序时仅协调发生变化的节点，并使用非线性 FLIP 动画呈现位置与角色外壳尺寸变化。角色使用实色色块构成 Scratch 风格的中空外壳；空状态只显示一条窄槽，加入其他类型积木后槽位随内容扩张。

## 扩展接口

- 新主题：增加一个覆盖 CSS 变量的主题文件，并在 `index.html` 引入。主题切换集中在 `scripts/modules/theme.js`。
- 新模型：服务端模型调用集中在 `PromptPairHandler.call_model`，浏览器只依赖 `/api/health` 和 `/api/generate`。
- 新设置：在 `scripts/modules/` 增加模块并从 `main.js` 初始化；敏感设置只能留在服务端。
- 新语言：增加 i18n JSON，并在 `assets/config/app.json` 的 `locales` 中登记。
- 设置 API：`GET /api/settings` 读取可编辑配置，`PUT /api/settings/app` 保存语言，`PUT /api/settings/prompts/<category-id>` 保存受控分类。

只有用户点击生成时，当前积木的标题、类型和内容才会发送到 `.env` 指定的模型服务。
