# fullstack-journey

12 周全栈 + AI Agent 转型计划的主项目仓库。W1 建立工程骨架，后续所有代码长在这里。

## 目录

```
packages/
├── core/    @fj/core  —— 错误模型与集合取值（Result / first / second / assertNever）
├── utils/   @fj/utils —— 纯格式化工具（formatBytes）
└── app/     @fj/app   —— 应用入口（W2 换成 NestJS，W7 之后接 AI Agent）
```

**加包三件套**（少一步就是 `TS2307`）：
1. `packages/<name>/package.json` 里 `name` 写对，`exports` 指向 `./dist/index.js`
2. 调用方的 `tsconfig.json` 的 `references` 加 `{ "path": "../<name>" }`
3. 根 `tsconfig.json` 的 `references` 加该包，然后 `pnpm install` 建链接

## 常用命令

| 命令             | 作用                             |
| ---------------- | -------------------------------- |
| `pnpm dev`       | 起 app，改文件自动重启           |
| `pnpm build`     | tsc -b 增量构建全部包到各自 dist |
| `pnpm typecheck` | 强制全量类型检查                 |
| `pnpm lint`      | ESLint（含类型感知规则）         |
| `pnpm format`    | Prettier 格式化                  |
| `pnpm check`     | typecheck + lint，提交前跑这个   |

## 工程要点

- **TypeScript 5.9 + NodeNext**：后端场景严格按 Node 的 ESM 规则解析，相对导入要写 `.js` 后缀。
- **strict 之上再加三条**：`noUncheckedIndexedAccess`、`noImplicitOverride`、`noFallthroughCasesInSwitch`。
- **ESLint 9 flat config**：`.ts` 走 `recommendedTypeChecked`（能查漏 await），配置文件走非类型规则，最后用 `eslint-config-prettier` 关掉格式冲突。
- **项目引用（project references）**：`tsc -b` 按依赖顺序构建，core 先于 app。
- **运行时直接跑 TS**：Node 22.18+ 原生支持类型擦除，`node --watch src/index.ts` 即可，不需要 tsx。

## 本机特殊处理

`node_modules` 里的 workspace 包链接（`@fj/core`）在这台机器上创建符号链接会静默失败，表现为 `Cannot find module '@fj/core'`。
兜底方案是 `scripts/link-workspace.mjs`：根 `postinstall` 自动执行，用不需要特权的 junction 补齐链接。换机器后如果 pnpm 正常，这个脚本会全部输出 `skip`，不会干扰。

## 提交规范

`feat:` / `fix:` / `chore:` / `docs:` 前缀，一次提交只做一件事。
