# macOS / Linux 部署与代理注意事项

本文记录本 fork 在 Linux 和 macOS 上的部署经验。路径、域名及代理地址均使用示例；不要提交真实凭据、代理认证信息、私钥或 Codex 账号状态。

## 构建与运行环境

本次 macOS 部署验证使用 Node.js 24.21.0、npm 11.19.0 和 PM2 7.1.0。以下 Node 参数需使用支持它们的版本，升级或切换解释器后应重新验证。

```sh
npm install -g pm2
brew install nginx websocat
npm ci --ignore-scripts
npm rebuild better-sqlite3
HOSTED_CODEX_APP_ZIP=/absolute/path/to/pinned-desktop.zip npm run build
```

使用仓库构建配置对应的 Desktop ZIP，并核对校验值。对比两台机器时应同时核对 Git commit、Desktop ZIP 和实际生成的前端资源，不能只比较仓库分支。本次使用 Desktop 26.1007.30912。不要将编译产生的未跟踪 JS、声明和 source map 文件顺手加入提交。

macOS 初始化会调用 Electron Dock stub 的 bind/call/apply；本 fork 的 db3ec65 修复了这些函数方法被深层 stub 吞掉的问题。Linux 未走同一 Dock 初始化路径，因此可能不触发。此兼容修复与下面的代理配置是两个独立问题。

## Web 与 app-server 分开运行

参考 README 的独立 app-server 部署方式，让 Web 重启不打断后台任务：

- app-server 使用自己的 Codex CLI、CODEX_HOME 和 Unix socket。
- Web 通过 CODEX_CLI_PATH 指向 scripts/codex_remote_proxy，并通过 CODEX_UNIX_SOCKET 连接该 socket；部署前确认 websocat 在服务 PATH 中。
- Web 可使用独立 CODEX_HOME 保存界面状态；不要把它与后端账号目录混为一谈。
- PM2 使用 Node 解释器和脚本的绝对路径，PATH 也应明确配置，避免 fnm 交互式 shell 的临时路径影响登录后启动。
- 项目路径使用磁盘上的实际大小写；macOS 能访问大小写不同的路径，不代表 Linux 也能。

不要仅凭一次直接 WebSocket 探针失败就判断 CLI 版本不兼容，应验证实际代理通道的 initialize 握手。

## 代理文件必须接入 Web 进程

可将已有主机的 ~/.codex/.env 安全迁移到新主机，并设置权限 600。示例：

```dotenv
HTTP_PROXY="http://proxy.example.internal:7890"
HTTPS_PROXY="http://proxy.example.internal:7890"
NO_PROXY="localhost,127.0.0.1,::1"
```

按实际网络补充 NO_PROXY 中的域名和地址；不同客户端对 CIDR 的支持可能不同，不要假定所有客户端解释方式一致。代理地址必须从新主机可达；源主机的 127.0.0.1 代理不能直接照搬。

**把文件放进 ~/.codex 并不意味着 codex-web 会自动读取它。** Web 是独立 Node 进程，本仓库启动逻辑没有自动加载该文件。CLI 是否加载它也不能替代 Web 配置，子进程不会把环境变量回传给父进程。

在 PM2 的 codex-web 应用配置中添加：

```js
node_args: [
  "--env-file=/absolute/home/.codex/.env",
  "--use-env-proxy",
],
```

第一个参数加载文件，第二个参数让支持此选项的 Node 内置网络客户端使用代理环境变量。使用绝对路径，不要在参数中写 ~；读取外部文件不要求它位于 Web 的 CODEX_HOME 下。已有进程环境变量优先于 env 文件，排查时也要检查 PM2 保存的 HTTP_PROXY、HTTPS_PROXY、NO_PROXY 是否覆盖了文件。此设置不保证第三方网络库自动使用代理。

仅重启 Web 并保存进程清单：

```sh
pm2 startOrRestart /absolute/path/ecosystem.config.cjs --only codex-web --update-env
pm2 save
```

修改 env 文件后需要重启对应进程。以上操作不更新正在运行的独立 app-server 环境；若后端也需要变更代理，应另行安排其重启。

## 同版本却出现不同 UI 时

此次 Linux 显示新版侧边导航，macOS 显示旧版菜单；两端主要前端资源的哈希一致。macOS Web 日志出现 Statsig 初始化 fetch failed，而 Web 启动配置缺少 Linux 已有的代理支持。

迁移代理文件、添加上述 Node 参数并重启 Web 后，用户确认两端 UI 一致。因此遇到此类差异，应先检查功能开关请求的网络路径、登录状态及缓存，不能直接归因于操作系统或前端版本。没有必要为这次问题硬编码开启 UI 功能开关。

验证时区分三个层次：

1. PM2 配置和实际进程启动参数正确，服务保持 online。
2. 本地 Web 返回 HTTP 200，反向代理、认证和 WebSocket 通道正常。
3. 浏览器刷新后实际界面符合预期，初始化日志没有持续的网络失败。

直接 GET 功能开关初始化地址返回 403，不等同于真实登录后的初始化请求失败或成功；不能单凭它判断代理配置是否解决问题。也不要把未认证探测替代浏览器验证。

## Nginx 与登录后恢复

Web 监听 127.0.0.1，由 Nginx 提供 HTTPS、访问认证与 WebSocket 转发。上游端口应与 Web 参数一致；本次部署使用 8215，项目默认端口为 8214。

Nginx 的 http 作用域需要 WebSocket connection 映射，代理 location 至少包含：

```nginx
# http context
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

# inside the HTTPS server block
location / {
    proxy_pass http://127.0.0.1:8215;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 86400;
}
```

这只是代理片段；TLS 证书、server_name 和认证应在完整 server 配置中设置。自签名证书需由访问设备信任。先运行 nginx -t，再 reload。排查 DNS 拦截时可用 curl --resolve 配合正确的 Host/SNI 和证书验证访问目标，避免向错误解析地址发送登录凭据。

macOS 的用户 LaunchAgent（RunAtLoad）和用户级 brew services 通常在该用户登录后启动，不能描述成“无人登录也会开机启动”。PM2 的恢复入口使用固定 Node 路径执行 pm2 resurrect；配置修改后执行 pm2 save，并检查已加载的 LaunchAgent 与保存清单。若需要无人登录启动，需另行配置系统级服务。

## macOS Computer Use

See [Computer Use deployment notes](COMPUTER_USE.md) for the native helper, MCP setup, permissions, and validation boundaries.
