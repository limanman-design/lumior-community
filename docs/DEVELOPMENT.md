# 从源码开发

需要 Node.js 24、pnpm 11.25.0；依赖版本由根目录和 `desktop/` 各自的锁文件确定。无需 `.openai/hosting.json`、官方网关源码、官方模型凭据或签名证书即可进行普通社区构建。

```sh
pnpm install --frozen-lockfile
pnpm --dir desktop install --frozen-lockfile
node desktop/node_modules/electron/install.js
pnpm dev --port 3001
```

桌面开发使用 `pnpm desktop:dev`；资源构建使用 `pnpm desktop:build`；未签名的本机目录包使用 `pnpm --dir desktop pack`。社区生产包使用独立的 Lumior Community 身份，官方更新关闭。开发预览另有自己的开发数据目录。请用合成资料进行验证，通过备份导入需要的样例，不直接指向官方工作区。

`pnpm build` 生成网页产物，`pnpm start` 在 Node 服务启动它。自托管时需要自行管理访问控制和网络边界；默认生产启动监听地址为 `0.0.0.0`。本地开发使用 localhost。

## 代码导航

| 路径 | 作用 |
| --- | --- |
| `app/` | 工作区、画板、阅读器、资料存储和界面 |
| `lib/ai-runtime.ts` | AI 授权、任务生命周期和统一调用入口 |
| `lib/thesis/`、`skills/`、`templates/` | MBA 助手与原始文本 |
| `desktop/` | Electron 主进程、本地后端与社区构建 |
| `design-system/` | 共享色板与界面规范 |
| `tests/` | 应用回归与模拟协议测试 |

## 验证

```sh
pnpm colors:check
node node_modules/typescript/bin/tsc --noEmit --incremental false
pnpm test:public
pnpm build
pnpm desktop:build
```

公开测试不需要模型 Key。私有计费网关与部署测试由官方运营工程保留，公开套件覆盖客户端协议，两者不能互相替代。生产构建通过也不代表 Windows/macOS 的全部原生交互都已实机通过。

PDF 原版式服务是可选 Python 实验，涉及另外的引擎许可和运行环境，未安装时仍可使用普通翻译。社区开始贡献不需要安装这项实验。
