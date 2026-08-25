# MC Bot Agent（Mineflayer 执行代理）

连接后端控制面，用 Mineflayer 控制 Minecraft 假人（bot），接收并执行 AI 调度命令。

## 架构位置

```
前端面板 9.5:3000 ──→ 后端 9.6:8000 ──→ Ollama 9.6:11434 (qwen3:8b)
                          ↑ ws://192.168.9.6:8000/ws/agents
                    本代理（agent/，任意能跑 Node 的机器）
                          ↓ mineflayer 协议
                    MC 服务器（需自备，如 Paper/Folia，端口 25565）
```

## 安装

```bash
cd agent
npm install        # 需要 Node.js 18+（本机 v22 可用）
```

## 配置（环境变量）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BACKEND_WS` | `ws://192.168.9.6:8000/ws/agents` | 后端 WebSocket |
| `AGENT_ID` | `agent-mtn` | 代理节点 ID（唯一） |
| `NODE_NAME` | `mtn-node` | 节点显示名 |
| `MC_SERVER` | `127.0.0.1` | MC 服务器地址 |
| `MC_PORT` | `25565` | MC 服务器端口 |
| `AGENT_BOTS` | 两个示例假人 | JSON 数组，见下 |

`AGENT_BOTS` 示例：

```json
[{"bot_id":"bot-001","display_name":"农工一号","game_server":"survival","username":"BotFarmer1"},
 {"bot_id":"bot-002","display_name":"矿工二号","game_server":"survival","username":"BotMiner1"}]
```

Windows PowerShell 启动示例：

```powershell
$env:MC_SERVER="192.168.9.5"; $env:MC_PORT="25565"
$env:AGENT_BOTS='[{"bot_id":"bot-001","display_name":"农工一号","game_server":"survival","username":"BotFarmer1"}]'
npm start
```

## 内置任务（tasks.js 可扩展）

| task 名 | 参数 | 说明 |
|---------|------|------|
| `daily_login` | — | 登录打卡（发 !daily + 走动） |
| `explore` | `range`, `loops` | 随机探索 |
| `follow_player` | `player` | 跟随玩家直到 stop |
| `farm_wheat` | `max_blocks`, `limit` | 收获附近成熟小麦 |
| `say_hello` | — | 聊天打招呼 |
| `stop_task` | — | 立即结束 |

## 协议行为

- 连上后端先发 `register`，收到 `registered` 后开始心跳/状态上报
- 状态每 5s 上报（hp/位置/任务进度），心跳每 10s
- 断线自动重连（指数退避，最多 30s）
- 命令：`run_task` / `pause` / `resume` / `stop` / `screenshot`（截图不支持，返回视角实体清单）

## 验证

后端跑着时启动代理，在面板「机器人」页应看到 bot 注册；给 bot 发 `run_task`（如 `say_hello` 或 `explore`），假人会实际执行。MC 服务器未就绪时，假人状态显示 `error`（连不上服务器），但注册/心跳/命令链路仍正常。
