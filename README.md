# pi-flow-tidy

`pi-flow-tidy` 为 Pi 的工具调用提供统一、紧凑、易读的终端展示。它会将内建工具和第三方工具整理为两行摘要，集中显示工具名称、操作目的、目标和结果，并在调用完成后显示耗时，同时保留展开查看完整输出的能力。

```text
 ▌ 🔍 custom_search locate matching source files                              27ms
 ▌    ╰ createUniversalTidy in runtime/universal-tidy.mjs → 2 matches in 1 file
```

工具类别、执行状态和关键信息使用不同颜色显示，并自动适配当前 Pi 主题。

## 主要功能

- 默认以两行摘要呈现工具调用，减少长输出对会话阅读的干扰。
- 保留工具的原始名称，方便识别内建工具和第三方扩展。
- 使用 Emoji 和主题色区分搜索、读取、编辑、执行等工具类别。
- 清晰区分运行中、成功和失败状态。
- 在第一行显示操作目的，并在调用完成后显示最终耗时；第二行显示目标与结果摘要。
- 支持展开查看完整输出、错误信息或文件差异。
- 自动适配会话启动后动态注册的第三方工具。
- 恢复历史会话或重载扩展时，仍可使用紧凑渲染。
- 为兼容的工具提供可选 `reasoning` 字段，用于生成简短中文操作说明。
- 未提供 `reasoning` 时，可根据命令、路径、搜索条件等参数自动生成摘要。
- 耗时数据仅保存在当前进程内存中，不会写入工具结果或会话文件。
- 不依赖特定的搜索、文件管理或工具增强扩展。

## 工具分类

分类根据工具原始名称自动判断。未识别的工具会使用通用样式，不影响工具执行。

| 类别 | 常见名称 | 图标 |
|---|---|:---:|
| 编排 | `parallel`、`batch`、`multi` | 🧬 |
| 任务 | `todo`、`task`、`plan` | 📋 |
| 编辑 | `edit`、`patch`、`replace` | ✏️ |
| 搜索 | `grep`、`search`、`query` | 🔍 |
| 查找 | `find`、`glob`、`list` | 📂 |
| 读取 | `read`、`open`、`inspect` | 📖 |
| 写入 | `write`、`create`、`save` | 💾 |
| 执行 | `bash`、`shell`、`exec` | 💻 |
| 删除 | `delete`、`remove`、`purge` | 🗑️ |
| 交互 | `ask`、`prompt`、`confirm` | 💬 |
| 通知 | `notify`、`alert`、`message` | 🔔 |
| 网络 | `web`、`http`、`browser` | 🌐 |
| 视觉 | `image`、`screenshot`、`diagram` | 🖼️ |
| 版本控制 | `git`、`commit`、`branch` | 🌿 |
| 数据 | `time`、`weather`、`finance` | 📊 |
| 通用 | 其他工具 | 🧩 |

## 工作方式

这是一个标准 Pi Package，通过 `/flow-tidy` 命令提供安装、状态检查、修复和卸载功能。

为了统一处理其他扩展注册的工具，项目会安装一个透明启动器，在 Pi 启动时接入工具渲染流程。启动器不会改变工具的名称、参数或返回结果，只负责调整终端显示。

如果当前 Pi 版本不再支持所需的运行时接口，扩展会显示警告并停止应用紧凑渲染。此时仍可使用 `pi-raw` 直接启动官方 Pi 入口。

## 要求

- Node.js 20 或更新版本。
- 已安装 `@earendil-works/pi-coding-agent`。
- 当前完整验证版本：Pi `0.85.1`。
- 支持 Windows、Linux 和 macOS。

## 一条命令安装

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/RS-XuRan/pi-flow-tidy/main/install.ps1 | iex
```

### Linux 或 macOS

```bash
curl -fsSL https://raw.githubusercontent.com/RS-XuRan/pi-flow-tidy/main/install.sh | sh
```

安装脚本会安装 Pi Package、配置启动器，并保留被替换命令的备份。完成后请重启终端，再运行：

```bash
pi
```

默认命令目录：

- Windows：`%USERPROFILE%\bin`
- Linux 和 macOS：`~/.local/bin`

安装器会在需要时将该目录加入用户 PATH。

## 标准 Pi Package 安装

也可以使用 Pi 的标准包管理命令：

```bash
pi install git:github.com/RS-XuRan/pi-flow-tidy
```

然后在 Pi 中执行：

```text
/flow-tidy install
```

重启终端和 Pi 后生效。

## 查看状态

在 Pi 中执行：

```text
/flow-tidy status
```

安装配置保存在：

```text
~/.pi/agent/pi-flow-tidy.json
```

## 更新与修复

更新扩展：

```bash
pi update --extension git:github.com/RS-XuRan/pi-flow-tidy
```

更新后，在 Pi 中重新检查并修复启动配置：

```text
/flow-tidy repair
```

安装脚本和修复命令都可以重复执行。

## 临时禁用

Linux 或 macOS：

```bash
PI_FLOW_TIDY=0 pi
```

PowerShell：

```powershell
$env:PI_FLOW_TIDY = "0"
pi
```

直接使用官方 Pi 入口：

```bash
pi-raw
```

## 卸载

先在 Pi 中移除扩展创建的启动命令：

```text
/flow-tidy uninstall
```

重启终端后移除 Pi Package：

```bash
pi remove git:github.com/RS-XuRan/pi-flow-tidy
```

卸载器只会删除本扩展创建的启动命令，不会影响同一目录中的其他文件或其他 Pi 扩展。

## 安全与回退

Pi 扩展拥有完整的系统访问权限。本项目会：

- 在用户级 Pi 配置目录保存安装信息。
- 在用户命令目录创建 `pi` 和 `pi-raw` 启动命令。
- 在替换已有命令前将其备份到 `~/.pi/agent/backups/`。
- 在 Windows 上按需更新用户 PATH。

如需绕过本扩展，请运行：

```bash
pi-raw
```

## Development

```bash
npm test
npm run check
```

GitHub Actions 会在 Windows 和 Linux 的 Node.js 20、22、24 环境运行测试。

## License

MIT

---

## English quick start

Install on Windows:

```powershell
irm https://raw.githubusercontent.com/RS-XuRan/pi-flow-tidy/main/install.ps1 | iex
```

Install on Linux or macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/RS-XuRan/pi-flow-tidy/main/install.sh | sh
```

Restart the terminal after installation, then run `pi`. Use `/flow-tidy status` to inspect the extension or `pi-raw` to start Pi without the custom renderer.
