# macOS Computer Use 部署说明

本文记录本 fork 的原生 Computer Use 接入方法。所有路径均为示例；实际配置留在部署主机，不要提交账号、内网地址、访问密码、截图、会话日志或完整环境变量。

## 能力与验证范围

Computer Use 包含原生辅助程序、Node 工具运行时、MCP 接口和应用访问授权。安装桌面版 ChatGPT 或看到相同的 Web UI，并不代表 Web 会话已获得这些工具。

此次接入通过独立的 `codex_web_cua` MCP 服务暴露配套 `@oai/cua-repl`，启用 `computer` surface。它可通过原生界面访问 Chrome，不包含桌面版内置浏览器或 Chrome 扩展的专用通道。

已验证配套原生模块加载、MCP 初始化、应用列表、Chrome 窗口控件读取及截图；正式 app-server 已列出工具且没有工具初始化错误。点击、输入和完整 Web 会话交互不属于这次只读验证范围，部署后应在 Web 会话中继续验收。

## 原生程序应位于独立目录

不要直接运行嵌套在解包 `ChatGPT.app` 内的 Computer Use 辅助程序。本次观察到：

- 辅助功能检查使用 `com.openai.sky.CUAService`，权限通过。
- 同一进程的录屏检查被归到外层 `com.openai.codex`，权限未通过。
- 因此，即使系统设置中 Computer Use 的录屏开关已开启，仍反复提示授权和重启。

将签名完整的辅助程序复制到外层应用包之外，重新启动后，窗口读取和截图通过。此结论来自本次环境的日志与验证，不应将所有权限错误都归因于同一原因。

```sh
# Replace this with the actual checkout location.
CODEX_WEB_ROOT=/absolute/path/to/codex-web
CUA_RESOURCES="$CODEX_WEB_ROOT/scratch/ChatGPT.app/Contents/Resources"
CUA_STATE="$HOME/.local/state/codex-web/computer-use"
mkdir -p "$CUA_STATE/home"
ditto "$CUA_RESOURCES/cua_node/lib/node_modules/@oai/sky/Codex Computer Use.app" \
  "$CUA_STATE/Codex Computer Use.app"
codesign --verify --deep --strict "$CUA_STATE/Codex Computer Use.app"
```

保留原始签名和应用标识，不修改系统权限数据库。通过系统设置完成辅助功能和录屏授权，按提示重启对应辅助程序。同一标识的多份程序可能共享授权；不能把系统权限重置当成仅清除测试副本的操作。

## 启动工具服务

保存为部署目录中的 `computer-use.sh`，将示例路径替换为真实绝对路径，并设置可执行权限。运行时、工具包和原生程序应来自与当前部署匹配的资源包；升级后重新验证，不要随意混用桌面版另一版本的插件缓存。

```sh
#!/bin/sh
set -eu
CODEX_WEB_ROOT=/absolute/path/to/codex-web
CUA_RESOURCES="$CODEX_WEB_ROOT/scratch/ChatGPT.app/Contents/Resources"
CUA_RUNTIME="$CUA_RESOURCES/cua_node"
CUA_MODULES="$CUA_RUNTIME/lib/node_modules"
CUA_STATE="$HOME/.local/state/codex-web/computer-use"

export CODEX_HOME="$CUA_STATE/home"
export CUA_REPL_NODE_REPL_PATH="$CUA_RUNTIME/bin/node_repl"
export CUA_REPL_ENABLED_SURFACES=computer
export NODE_REPL_NODE_MODULE_DIRS="$CUA_MODULES"
export NODE_REPL_NODE_PATH="$CUA_RUNTIME/bin/node"
export NODE_REPL_TRUSTED_CODE_PATHS="$CUA_MODULES"
export NODE_REPL_TRUSTED_SERVICES='{"sky":"@oai/sky/service"}'
export SKY_CUA_SERVICE_PATH="$CUA_STATE/Codex Computer Use.app"
export CODEX_CLI_PATH="$CUA_RESOURCES/codex-cli/CodexCLI.app/Contents/MacOS/codex"

/usr/bin/open -g "$SKY_CUA_SERVICE_PATH"
exec "$CUA_RUNTIME/bin/node" "$CUA_MODULES/@oai/cua-repl/bin/cua-repl.mjs"
```

这里的 CODEX_HOME 仅用于工具子进程，不要据此替换 app-server 保存账号和会话的目录。该方案需要可用的 macOS 用户桌面会话；不能仅凭 PM2 online 就认为无人登录时也能操作桌面。

在 PM2 的独立 app-server 参数中，保留已有参数并在 `app-server` 子命令前增加：

```js
"-c",
'mcp_servers.codex_web_cua={command="/absolute/path/to/computer-use.sh",enabled=true,startup_timeout_sec=120}',
```

使用专用服务名可与桌面版管理的工具配置区分。配置仅作为该后端的启动覆盖项，不需要改写共享的用户 config.toml。安排好后台任务后重启 app-server，让 Web 重新连接，再执行 `pm2 save`。重启 Web 本身不会更新独立后端的工具配置。

## 授权与验收

应用访问批准和 macOS 系统权限是两层机制。MCP 客户端需要支持 `elicitation/create` 表单请求，并将应用访问请求呈现给用户；正式服务不能加入测试用的自动批准逻辑。

建议按以下顺序验证：

1. 用真实后端的 `mcpServerStatus/list` 确认 `codex_web_cua` 包含 `js`、`js_reset` 等工具，检查 `toolsError`。
2. 在刷新后的 Web 会话中确认模型可发现这些工具。
3. 先读取应用列表，再批准一次指定应用的只读访问，验证窗口控件和截图。
4. 将点击、输入等操作作为后续单独验收，不用“初始化成功”替代实际操作结果。

如提示 `Sky native addon is unavailable`，检查资源路径及配套 `native/sky.node` 是否存在、能否加载。如提示 `Bundled CUA skill version mismatch`，检查当前资源包与插件缓存版本；不要直接关闭版本或授权检查。

如反复提示权限不足，结合实际进程路径、签名和系统日志确认权限检查归属。不要让用户无限重复开关权限。测试结束后关闭测试进程，删除测试脚本、临时会话与截图；没有持久保存的单次批准无需另行重置系统权限。

## 维护边界

这次接入属于主机部署配置，不是 fork 的运行时代码改动。原生应用虽单独存放，仍沿用官方应用标识，不保证能与另一个版本同时独立运行。升级、桌面版并行使用及登录后恢复都需要验证实际服务路径和版本。

维护时保留配置备份及回滚路径。回滚可移除该后端的专用 MCP 启动覆盖项并重启、保存 PM2；不要顺带清除其他应用仍在使用的系统授权。
