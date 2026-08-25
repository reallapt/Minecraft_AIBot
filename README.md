# 遥控假人

一个用网页控制面板管理电脑上多个游戏窗口、由本地小模型 AI 自动调度的机器人系统。

## 项目介绍

玩游戏多开时，不需要再手动切换窗口、逐个操作或一直盯着状态。本项目把多窗口管理、任务调度和异常决策集中到一个控制台；AI 模型运行在本地，不依赖云端 API。

## 核心能力

- **网页端统一管控**：在浏览器查看所有机器人状态、下发任务和查看实时事件。
- **多机器分布式执行**：后端运行在 AI 服务器，执行代理部署到各游戏机器，通过 WebSocket 实时通信。
- **本地 AI 自动调度**：使用本地 Qwen3 8B 分配任务、检测异常并决定恢复策略。
- **后台无感操作**：通过 Windows 消息机制后台点击，不独占鼠标。
- **异常自愈**：机器人卡住时分析状态并选择重试、跳过或重启。

## 技术亮点

- **AI 只做大脑不做手**：模型输出高层指令，由确定性脚本执行，提升稳定性。
- **快慢双系统**：常规操作走毫秒级 CV 模板匹配，异常或新场景再调用视觉模型，节省算力。
- **完全本地**：模型、数据和控制链路可留在本机或内网，无隐私泄露和云端 API 费用。
- **8B 模型即可运行**：针对消费级显卡优化，不要求大显存。

## 系统架构

```text
前端（Docker）       后端（AI 服务器）          执行代理（游戏机器）
React + TypeScript -> FastAPI + Ollama     -> 窗口控制 / 截图 / CV
Vite + Nginx          REST + WebSocket         Mineflayer / 自动化脚本
```

仓库当前包含 React 前端、FastAPI 后端、Node.js/Mineflayer agent、Redis 编排文件，以及可选的 Folia AI 聊天插件。

## 目录结构

| 目录 | 说明 |
| --- | --- |
| `backend/` | FastAPI API、WebSocket、机器人管理和 AI 服务 |
| `frontend/` | React + TypeScript + Vite 控制台 |
| `agent/` | Node.js agent，使用 Mineflayer 控制 Minecraft 假人 |
| `folia-ai-chat/` | Folia/Paper 插件和可部署 JAR |
| `docker-compose.yml` | 后端和 Redis 的 Docker 编排 |

## 快速开始

### Docker 启动后端和 Redis

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

- API 文档：`http://127.0.0.1:8000/docs`
- 健康检查：`http://127.0.0.1:8000/health`
- Agent WebSocket：`ws://127.0.0.1:8000/ws/agents`
- Dashboard WebSocket：`ws://127.0.0.1:8000/ws/dashboard`

### 本地启动后端

要求：Python 3.12+、uv、Docker（Redis）。

```powershell
cd backend
uv venv .venv
uv pip install --python .venv\Scripts\python.exe -e ".[dev]"
.venv\Scripts\python.exe -m uvicorn app.main:app --env-file .env --reload --host 127.0.0.1 --port 8000
```

Windows 用户也可以运行 `backend\start.bat`。

### 启动前端

要求：Node.js 20+、Corepack、pnpm 10+。

```powershell
cd frontend
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://127.0.0.1:5173`。Vite 会把 `/api`、`/health` 和 `/ws` 代理到本地后端。

### 启动 Agent

```powershell
cd agent
npm install
$env:BACKEND_WS="ws://127.0.0.1:8000/ws/agents"
$env:MC_SERVER="127.0.0.1"
$env:MC_PORT="25565"
$env:AGENT_ID="agent-local"
$env:NODE_NAME="local-node"
$env:AGENT_BOTS='[{"bot_id":"bot-001","display_name":"Farmer","game_server":"survival","username":"BotFarmer1"}]'
npm start
```

首次运行会在 `agent/bot-passwords.json` 中生成机器人密码，请勿提交真实凭据。

## 环境变量

根目录 `.env.example` 包含后端和 AI 配置。常用变量：

| 变量 | 说明 |
| --- | --- |
| `MC_API_KEY` | API 和 WebSocket Bearer token |
| `MC_CORS_ORIGINS` | 允许的前端来源，逗号分隔 |
| `MC_OLLAMA_BASE_URL` | Ollama 地址，如 `http://127.0.0.1:11434` |
| `MC_OLLAMA_MODEL` | AI 模型，默认 `qwen3:8b` |
| `MC_OLLAMA_API_KEY` | Ollama 代理 token（可选） |
| `MC_HEARTBEAT_TIMEOUT_SECONDS` | Agent 心跳超时，默认 45 秒 |

独立部署前端时，在 `frontend/.env` 设置 `VITE_API_BASE`（必须以 `/api/v1` 结尾）和 `VITE_WS_BASE`，然后重新构建。不要把密钥写入 `VITE_*` 变量。

## Folia 插件

将 `folia-ai-chat/folia-ai-chat-bot-management.jar` 放入 Folia/Paper 的 `plugins/` 目录。玩家可以使用 `@bot <问题>` 触发 AI 回复，管理员使用 `/botmanager reload` 重载配置。权限为 `foliaaichat.use` 和 `foliaaichat.admin`。

## API 概览

API 前缀为 `/api/v1`：

- `GET /bots`、`GET /bots/{bot_id}`：查询机器人
- `POST /bots/{bot_id}/commands`：发送任务、暂停、恢复、停止、库存等命令
- `GET /bots/{bot_id}/inventory`：查询背包
- `GET /events`：查看最近事件
- `GET/POST /ai/*`：检查 AI、查看或创建 AI 决策、转发聊天请求

## 检查与测试

```powershell
cd backend
pytest
cd ..\frontend
pnpm lint
pnpm run build
```

## 项目依赖

### 前端实际依赖

| 项目名称 | 作者 / 组织 | 用途 | 许可证 |
| --- | --- | --- | --- |
| **React** | Meta (Facebook) | UI 框架 | MIT |
| **React DOM** | Meta | React 渲染层 | MIT |
| **React Router DOM** | Remix Software | 客户端路由 | MIT |
| **Lucide React** | Lucide 社区 | 图标库 | ISC |
| **Vite** | Evan You / Vite Team | 构建工具 | MIT |
| **@vitejs/plugin-react** | Vite Team | React 插件 | MIT |
| **TypeScript** | Microsoft | 类型系统 | Apache-2.0 |
| **Oxlint** | Oxc Team | Linter | MIT |
| **@types/node** | DefinitelyTyped | Node 类型定义 | MIT |
| **@types/react** | DefinitelyTyped | React 类型定义 | MIT |
| **@types/react-dom** | DefinitelyTyped | React DOM 类型定义 | MIT |

### 后端实际依赖

| 项目名称 | 作者 / 组织 | 用途 | 许可证 |
| --- | --- | --- | --- |
| **FastAPI** | Sebastián Ramírez (tiangolo) | Web 框架 | MIT |
| **Uvicorn** | Tom Christie / Encode | ASGI 服务器 | BSD-3-Clause |
| **HTTPX** | Tom Christie / Encode | HTTP 客户端 | BSD-3-Clause |
| **Pydantic** | Samuel Colvin / Pydantic Team | 数据校验（FastAPI 内置） | MIT |
| **Starlette** | Tom Christie / Encode | ASGI 框架（FastAPI 内置） | BSD-3-Clause |
| **pytest** | pytest-dev | 测试框架 | MIT |
| **setuptools** | Python Packaging Authority | 打包工具 | MIT |

## 安全提示

- 生产环境请设置强随机 `MC_API_KEY` 并限制 `MC_CORS_ORIGINS`。
- 不要提交 `.env`、`backend/.env`、`frontend/.env` 或 `agent/bot-passwords.json`。
- 公网部署请使用 HTTPS/WSS 和反向代理。

## 许可证

本项目采用 [MIT License](https://opensource.org/licenses/MIT)。

---

# Remote Game Bot Controller

A local-AI-driven platform for managing multiple game windows from a web control panel and automating bot operations.

## Introduction

When running multiple game windows, operators no longer need to switch windows manually, operate each window separately, or watch every status. This project centralizes multi-window management, task scheduling, and exception decisions while keeping the AI model local instead of relying on cloud APIs.

## Core Capabilities

- **Unified web control**: inspect all bot statuses, dispatch tasks, and view live events from a browser.
- **Distributed execution**: run the backend on an AI server and deploy execution agents to game machines over WebSocket.
- **Local AI scheduling**: use a local Qwen3 8B model to assign tasks, detect anomalies, and choose recovery strategies.
- **Background operation**: perform background clicks through Windows messaging without taking over the physical mouse.
- **Self-healing**: analyze stuck bots and choose retry, skip, or restart actions.

## Technical Highlights

- **AI as the brain, deterministic tools as the hands**: the model emits high-level commands while deterministic scripts perform actions.
- **Fast and slow paths**: use millisecond-level CV template matching for routine operations and invoke a vision model only for abnormal or new scenes.
- **Fully local**: models, data, and control traffic can remain on the local machine or private network.
- **Consumer-GPU friendly**: designed around an 8B model without requiring large VRAM.

## Architecture

```text
Frontend (Docker)       Backend (AI server)       Execution agent (game machine)
React + TypeScript  ->  FastAPI + Ollama      ->  Window control / capture / CV
Vite + Nginx            REST + WebSocket          Mineflayer / automation scripts
```

The repository contains the React frontend, FastAPI backend, Node.js/Mineflayer agent, Redis composition, and an optional Folia AI chat plugin.

## Repository Layout

| Directory | Description |
| --- | --- |
| `backend/` | FastAPI API, WebSockets, bot manager, and AI service |
| `frontend/` | React + TypeScript + Vite dashboard |
| `agent/` | Node.js agent using Mineflayer to control Minecraft bots |
| `folia-ai-chat/` | Folia/Paper plugin and deployable JAR |
| `docker-compose.yml` | Docker composition for backend and Redis |

## Quick Start

### Start backend and Redis with Docker

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

- API docs: `http://127.0.0.1:8000/docs`
- Health: `http://127.0.0.1:8000/health`
- Agent WebSocket: `ws://127.0.0.1:8000/ws/agents`
- Dashboard WebSocket: `ws://127.0.0.1:8000/ws/dashboard`

### Local backend

Requirements: Python 3.12+, uv, and Docker for Redis.

```powershell
cd backend
uv venv .venv
uv pip install --python .venv\Scripts\python.exe -e ".[dev]"
.venv\Scripts\python.exe -m uvicorn app.main:app --env-file .env --reload --host 127.0.0.1 --port 8000
```

On Windows, you can also run `backend\start.bat`.

### Frontend

Requirements: Node.js 20+, Corepack, and pnpm 10+.

```powershell
cd frontend
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api`, `/health`, and `/ws` to the local backend.

### Agent

```powershell
cd agent
npm install
$env:BACKEND_WS="ws://127.0.0.1:8000/ws/agents"
$env:MC_SERVER="127.0.0.1"
$env:MC_PORT="25565"
$env:AGENT_ID="agent-local"
$env:NODE_NAME="local-node"
$env:AGENT_BOTS='[{"bot_id":"bot-001","display_name":"Farmer","game_server":"survival","username":"BotFarmer1"}]'
npm start
```

On first run, passwords are generated in `agent/bot-passwords.json`. Never commit real credentials.

## Environment Variables

The root `.env.example` contains backend and AI settings:

| Variable | Description |
| --- | --- |
| `MC_API_KEY` | Bearer token for API and WebSockets |
| `MC_CORS_ORIGINS` | Allowed frontend origins, comma-separated |
| `MC_OLLAMA_BASE_URL` | Ollama URL, such as `http://127.0.0.1:11434` |
| `MC_OLLAMA_MODEL` | AI model, default `qwen3:8b` |
| `MC_OLLAMA_API_KEY` | Optional Ollama proxy token |
| `MC_HEARTBEAT_TIMEOUT_SECONDS` | Agent heartbeat timeout, default 45 seconds |

For a separately deployed frontend, set `VITE_API_BASE` (must end in `/api/v1`) and `VITE_WS_BASE` in `frontend/.env`, then rebuild. Do not put secrets in `VITE_*` variables.

## Folia Plugin

Copy `folia-ai-chat/folia-ai-chat-bot-management.jar` into the Folia/Paper `plugins/` directory. Players can use `@bot <question>` to trigger an AI reply, and administrators can run `/botmanager reload`. Permissions are `foliaaichat.use` and `foliaaichat.admin`.

## API Overview

The API prefix is `/api/v1`:

- `GET /bots`, `GET /bots/{bot_id}`: list and inspect bots
- `POST /bots/{bot_id}/commands`: send tasks, pause, resume, stop, inventory, and related commands
- `GET /bots/{bot_id}/inventory`: request inventory
- `GET /events`: list recent events
- `GET/POST /ai/*`: inspect AI health, read/create decisions, and proxy chat completions

## Checks and Tests

```powershell
cd backend
pytest
cd ..\frontend
pnpm lint
pnpm run build
```

## Dependencies

### Frontend Runtime and Development Dependencies

| Project | Author / Organization | Purpose | License |
| --- | --- | --- | --- |
| **React** | Meta (Facebook) | UI framework | MIT |
| **React DOM** | Meta | React rendering layer | MIT |
| **React Router DOM** | Remix Software | Client-side routing | MIT |
| **Lucide React** | Lucide community | Icon library | ISC |
| **Vite** | Evan You / Vite Team | Build tool | MIT |
| **@vitejs/plugin-react** | Vite Team | React plugin | MIT |
| **TypeScript** | Microsoft | Type system | Apache-2.0 |
| **Oxlint** | Oxc Team | Linter | MIT |
| **@types/node** | DefinitelyTyped | Node type definitions | MIT |
| **@types/react** | DefinitelyTyped | React type definitions | MIT |
| **@types/react-dom** | DefinitelyTyped | React DOM type definitions | MIT |

### Backend Runtime and Development Dependencies

| Project | Author / Organization | Purpose | License |
| --- | --- | --- | --- |
| **FastAPI** | Sebastián Ramírez (tiangolo) | Web framework | MIT |
| **Uvicorn** | Tom Christie / Encode | ASGI server | BSD-3-Clause |
| **HTTPX** | Tom Christie / Encode | HTTP client | BSD-3-Clause |
| **Pydantic** | Samuel Colvin / Pydantic Team | Data validation (built into FastAPI) | MIT |
| **Starlette** | Tom Christie / Encode | ASGI framework (built into FastAPI) | BSD-3-Clause |
| **pytest** | pytest-dev | Testing framework | MIT |
| **setuptools** | Python Packaging Authority | Packaging tool | MIT |

## Security Notes

- Set a strong random `MC_API_KEY` and restrict `MC_CORS_ORIGINS` in production.
- Never commit `.env`, `backend/.env`, `frontend/.env`, or `agent/bot-passwords.json`.
- Use HTTPS/WSS and a reverse proxy for public deployments.

## License

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT).
