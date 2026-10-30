# Contributing / 贡献指南

欢迎可以复现的问题报告、小范围修复、文档与翻译改进。请使用合成示例，不要提交个人工作区、API Key、邀请码、服务日志中的凭据或无权分发的论文和媒体。

大功能先在 Issue 中说明用户需求、影响范围、存储兼容与验证方式。维护者确认范围后再实现。修复数据问题时保留旧工作区兼容，不以清空用户数据作为升级路径。

## 功能更新如何进入仓库

应用功能以公开仓库的最新 `main` 为基础，在独立分支修改后提交 Pull Request。通过自动检查和审阅后合入；源码合入不等于桌面安装包已经发布。官方安装包按平台单独构建、验证和发布，官网标明实际可下载版本。

维护者过渡期仍需从原工程同步时，只同步经过公开范围清单和转换检查的文件差异，不推送原私有 Git 历史，不整目录覆盖公开仓库。同步前先获取公开 `main`：若相同文件已有社区改动，应先合并并重新验证，保留贡献者提交。

界面截图使用当前版本及可公开的合成资料，并注明版本；不要使用私人工作区或未获许可的论文、图片。功能变化影响截图时随对应 PR 更新。

## 本地检查

按 [开发指南](docs/DEVELOPMENT.md) 安装后运行：

```sh
pnpm colors:check
node node_modules/typescript/bin/tsc --noEmit --incremental false
pnpm test:public
pnpm build
```

桌面相关修改还需 `pnpm desktop:build`，并验证受影响的平台。PR 说明具体问题、修改后的行为、实际执行的检查与未测项；界面改动提供亮色、暗色截图。不要把模拟 AI 测试写成真实供应商调用通过。

颜色统一维护在 `design-system/ui-palette.json`，业务引用共享变量。菜单沿用 12px 外框、8px 菜单项、4px 内边距。所有 AI 调用经过 `resolveAiAccess` / `createAiTask`，一次用户动作共用一个任务，不得在官方额度失败后静默使用个人 Key。

## 贡献来源与授权

项目主许可证为 [Apache-2.0](LICENSE)。按照该许可证第 5 条，除非明确另行声明，主动提交并供项目收录的贡献按 Apache-2.0 提供；已有单独签署的协议仍按其约定处理。请确认自己有权提交贡献，并保留第三方版权与许可说明。引入依赖或素材时同时提供来源和许可；修改第三方文件时注明修改。

贡献者保留其版权。本项目不要求版权转让；贡献者授予的版权与专利许可按 Apache-2.0 的条款执行。后续分发、修改和再许可均须遵守原许可证；超出既有授权的用途需另行取得必要授权。提交 PR 不代表接受尚未公布的贡献协议。

English: Unless explicitly stated otherwise, contributions intentionally submitted for inclusion are provided under Apache-2.0, subject to Section 5 and any separately executed agreement. Submit only contributions you have the right to provide, preserve third-party notices, mark modifications and describe validation accurately. Contributors retain copyright; the copyright and patent grants are those in Apache-2.0. This guide does not require copyright assignment.
