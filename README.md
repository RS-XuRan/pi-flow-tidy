# pi-flow-tidy

面向 Pi 的通用紧凑工具输出扩展：保留工具原始名称，以固定两行显示推理摘要、目标、结果摘要和耗时，并自动兼容会话启动后动态注册的第三方工具。新版视觉采用高亮状态竖条、统一双列彩色 Emoji、工具语义主题色、轻量状态底色与右对齐耗时，便于快速扫视并减轻连续调用时的色块压迫感。

```text
 ▌ 🔍 custom_search locate matching source files                              27ms
 ▌    ╰ createUniversalTidy in runtime/universal-tidy.mjs → 2 matches in 1 file
```

实际终端中，左侧加粗 `▌` 使用高亮状态色，工具名称和 `╰` 使用分类主题色，结果摘要与耗时使用醒目的 `warning` 黄色，Emoji 保留终端原生彩色字形。

## 功能

- 折叠状态固定显示两行，并在条带左右各保留 1 列空白。
- 保留工具原始名称，不创建别名。
- 使用统一双列彩色 Emoji 表达工具类别，避免单色字符与 Emoji 混排造成的宽度抖动。
- 工具名称和第二行 `╰` 连接符使用对应的 Pi 语义主题色。
- 执行状态与工具类别分离：左侧加粗 `▌` 是唯一状态指示，成功为高亮绿色、失败为高亮红色、运行中为高亮警告色。
- 运行中、成功和失败分别使用 `toolPendingBg`、`toolSuccessBg`、`toolErrorBg` 轻量状态底色。
- 结果摘要与耗时使用 `warning` 黄色；耗时固定显示在第一行最右侧。
- 第二行的 `→ done` 等结果尾部默认紧跟目标内容；仅当目标过长时才截断目标并将结果尾部贴到最右侧。
- 耗时只保存在当前进程内存中，不写入工具结果或会话文件；历史记录缺少计时数据时直接留空。
- 会话恢复或扩展重载时，即使第三方工具尚未完成注册，历史工具调用也使用可折叠的紧凑后备渲染。
- 注入的 `reasoning` 参数明确要求模型使用简短中文描述。
- 内建工具和第三方工具使用统一输出风格。
- 会话启动后动态注册的新工具也会自动接入。
- 为普通对象参数增加可选 `reasoning` 字段，并在调用原工具前移除该字段。
- 已经自带 `reasoning` 的工具保持原始参数语义。
- 未提供推理参数时，根据 action、path、pattern、command 等参数生成摘要。
- 展开状态继续显示完整输出或 diff，并延续左侧状态竖条。
- 不依赖任何特定搜索、文件管理或工具增强扩展。

## 视觉分类

分类基于原始工具名中的词元，不改名、不绑定具体第三方扩展。图标均选用 Pi 宽度计算为 2 列的彩色 Emoji：

| 类别 | 代表名称 | Emoji | Pi 语义主题色 |
|---|---|:---:|---|
| 编排 | `parallel`、`batch`、`multi` | `🧬` | `syntaxKeyword` |
| 任务 | `todo`、`task`、`plan` | `📋` | `customMessageLabel` |
| 编辑 | `edit`、`patch`、`replace` | `✏️` | `warning` |
| 搜索 | `grep`、`search`、`query` | `🔍` | `accent` |
| 查找 | `find`、`glob`、`list` | `📂` | `syntaxVariable` |
| 读取 | `read`、`open`、`inspect` | `📖` | `mdLink` |
| 写入 | `write`、`create`、`save` | `💾` | `syntaxString` |
| 执行 | `bash`、`shell`、`exec` | `💻` | `bashMode` |
| 删除 | `delete`、`remove`、`purge` | `🗑️` | `error` |
| 交互 | `ask`、`prompt`、`confirm` | `💬` | `mdHeading` |
| 通知 | `notify`、`alert`、`message` | `🔔` | `thinkingHigh` |
| 网络 | `web`、`http`、`browser` | `🌐` | `borderAccent` |
| 视觉 | `image`、`screenshot`、`diagram` | `🖼️` | `syntaxType` |
| 版本 | `git`、`commit`、`branch` | `🌿` | `thinkingHigh` |
| 数据 | `time`、`weather`、`finance` | `📊` | `syntaxNumber` |
| 通用 | 未识别的新工具 | `🧩` | `toolTitle` |

### 状态与布局

| 状态 | 左侧竖条颜色 | 背景 |
|---|---|---|
| 运行中 | 加粗 `warning` | `toolPendingBg` |
| 成功 | 加粗 `success` | `toolSuccessBg` |
| 失败 | 加粗 `error` | `toolErrorBg` |

状态色只出现在左侧加粗 `▌`，不再显示重复的 `✓`、`✗` 标记。成功与失败背景分别保留浅绿色、浅红色语义，结果摘要和耗时保持黄色。工具名称与 `╰` 连接符取自当前 Pi 主题，因此会自动适应暗色、亮色和自定义主题；Emoji 使用终端原生彩色渲染。未知工具使用通用后备样式，不影响执行和两行布局。

## 架构说明

这是一个标准 Pi Package，通过 `pi.extensions` 暴露 `/flow-tidy` 扩展命令。

Pi 的公开 Extension API 只能为扩展自己注册的工具定义渲染器，不能取得任意其他扩展的执行函数，也不能统一替换未来第三方工具的渲染定义。因此，自动美化任意工具需要一个透明 Pi 启动层，在工具注册表刷新时装饰工具定义。

启动层带有能力检测：如果未来 Pi 修改了内部刷新入口，它会输出警告并继续启动未美化的 Pi，不会阻止 Pi 正常使用。`pi-raw` 始终直接进入官方打包入口。

## 要求

- Node.js 20 或更新版本。
- 已安装 `@earendil-works/pi-coding-agent`。
- 当前完整验证版本：Pi `0.85.1`。
- Windows、Linux 或 macOS。

## 一条命令安装

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/RS-XuRan/pi-flow-tidy/main/install.ps1 | iex
```

Linux 或 macOS：

```bash
curl -fsSL https://raw.githubusercontent.com/RS-XuRan/pi-flow-tidy/main/install.sh | sh
```

安装脚本只安装 `pi-flow-tidy` 标准 Pi Package，并创建透明启动层，不会安装、删除或修改其他 Pi 扩展。

执行远程脚本前，可以先在仓库中检查 `install.ps1` 或 `install.sh`。安装完成后重启终端，再运行：

```bash
pi
```

Windows 安装器会把 `%USERPROFILE%\bin` 添加到用户 PATH。Linux 默认使用 `~/.local/bin` 和 `~/.profile`，macOS 默认使用 `~/.local/bin` 和 `~/.zprofile`。

## 标准 Pi Package 安装

也可以完全按照 Pi 的标准扩展流程安装：

```bash
pi install git:github.com/RS-XuRan/pi-flow-tidy
```

然后启动 Pi，执行：

```text
/flow-tidy install
```

重启终端和 Pi 后生效。

## 状态

在 Pi 中执行：

```text
/flow-tidy status
```

安装配置文件位于：

```text
~/.pi/agent/pi-flow-tidy.json
```

## 更新与修复

更新标准 Pi Package：

```bash
pi update --extension git:github.com/RS-XuRan/pi-flow-tidy
```

更新后在 Pi 中重新检测路径并修复包装器：

```text
/flow-tidy repair
```

也可以重新执行一条命令安装脚本；安装过程是幂等的。

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

完全绕过启动层：

```bash
pi-raw
```

## 卸载

先在 Pi 中移除管理的启动包装器：

```text
/flow-tidy uninstall
```

重启终端后移除标准 Pi Package：

```bash
pi remove git:github.com/RS-XuRan/pi-flow-tidy
```

卸载器只删除带有 `pi-flow-tidy managed wrapper` 标记的文件，不会删除同目录中的其他文件，也不会修改其他 Pi 扩展。

## 安全与回退

Pi 扩展拥有完整系统权限。本项目会：

- 写入用户级 Pi 配置目录。
- 在用户 bin 目录创建 `pi` 和 `pi-raw` 包装器。
- 在覆盖非本项目包装器前，将原文件备份到 `~/.pi/agent/backups/`。
- 在 Windows 用户 PATH 缺少 bin 目录时将其添加到 PATH。

如遇问题，运行：

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

The installer only installs `pi-flow-tidy`; it does not install, remove, or modify other Pi extensions. Restart the terminal and run `pi`. Use `/flow-tidy status` inside Pi and `pi-raw` to bypass the customization at any time.
