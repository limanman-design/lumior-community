# Lumior

[English](README.en.md) · [官网 / Downloads](https://lumior.work/) · [在线演示](https://demo.lumior.work/) · [反馈问题](https://github.com/limanman-design/lumior-community/issues)

Lumior 是本地优先的研究工作区：导入资料，阅读与摘录，在画板上连接观点，再用 AI 整理成笔记。

项目采用 [Apache-2.0](LICENSE)，第三方组件保留各自许可；源码范围与已知限制见 [项目状态](docs/OPEN-SOURCE-STATUS.md)。源码与官方安装包分别发布，下载版本请以官网为准。

## 可以做什么

- 用画板、笔记、PDF 批注、图片、视频和多维表组织资料。
- 导入 Obsidian 文件夹：原文逐篇保存，打开时读取，支持双链跳转、中断续传与文件夹备份。
- 使用自己的模型 API Key 对话、翻译和研究；MBA 助手的原始 Skill 和模板随源码提供。
- 在本机保存工作区；无需官方账号即可使用本地功能。

开源代码不附赠模型额度。官方托管 AI 服务独立运营，可以收费；社区构建默认使用个人 Key。AI 只会在用户主动发起相关操作时按功能需要发送内容，详见 [AI 与数据](docs/AI-DATA.md)。

## 从源码运行

需要 Node.js 24 和 pnpm 11.25.0。在项目根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm dev --port 3001
```

打开 `http://localhost:3001`。网页数据属于当前浏览器与网址，清理浏览器数据前请备份。

桌面开发：

```sh
pnpm --dir desktop install --frozen-lockfile
node desktop/node_modules/electron/install.js
pnpm desktop:dev
```

社区生产构建：

```sh
pnpm build
pnpm desktop:build
pnpm --dir desktop pack
```

社区版使用独立身份和数据目录，不连接官方自动更新。不要把正式工作区目录手动配置给开发版。更多说明见 [开发指南](docs/DEVELOPMENT.md)。

## 贡献

欢迎修复问题、完善文档、改进中英文表达，以及提供合成数据下的性能复现。开始较大功能前先讨论范围。提交前阅读 [贡献指南](CONTRIBUTING.md)、[AI 入口要求](docs/AI-ENTRY-ACCEPTANCE.md) 和 [界面规范](docs/UI-DESIGN-SYSTEM.md)。

```sh
pnpm colors:check
node node_modules/typescript/bin/tsc --noEmit --incremental false
pnpm test:public
pnpm build
```

## 当前边界

新 Obsidian 库支持标题与路径查找；全文索引、反向链接列表和关系图尚未实现。Windows 大库导入及文件夹备份仍需实机验收。PDF 原版式翻译引擎是可选实验，不随桌面包捆绑。首次启动不会自动加入 Game Studies 画板。

官方网关、计费后台、部署配置、签名凭据、私人资料和原私有仓库历史不在本仓库中。第三方许可与素材来源见 [NOTICE](NOTICE.md)；安全问题请使用 [私密报告渠道](SECURITY.md)，不要公开密钥或个人文档。
