/**
 * MC Bot Controller 执行代理（Mineflayer 版）
 *
 * 连接后端控制面 ws://<backend>/ws/agents，注册假人（bot），
 * 接收 run_task / pause / resume / stop / screenshot 命令，
 * 用 Mineflayer 控制 Minecraft 假人执行，并上报状态/心跳/任务结果。
 *
 * 配置（环境变量，均有默认值）：
 *   BACKEND_WS   后端 WebSocket 地址，默认 ws://192.168.9.6:8000/ws/agents
 *   AGENT_ID     本代理节点 ID，默认 agent-mtn
 *   NODE_NAME    节点名，默认 mtn-node
 *   MC_SERVER    Minecraft 服务器地址，默认 127.0.0.1
 *   MC_PORT      Minecraft 服务器端口，默认 25565
 *   AGENT_BOTS   JSON 数组：bot 注册信息 + 假人用户名
 *                默认两个示例假人：
 *                [{"bot_id":"bot-001","display_name":"农工一号",
 *                  "game_server":"survival","username":"BotFarmer1"},
 *                 {"bot_id":"bot-002","display_name":"矿工二号",
 *                  "game_server":"survival","username":"BotMiner1"}]
 *
 * 运行：npm install && npm start
 */
import { createBot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
const { pathfinder: pathfinderPlugin, Movements, goals } = pathfinderPkg;
import WebSocket from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { TASKS } from './tasks.js';

/** 生成随机密码（不含易混淆字符） */
function genPassword(len = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const rnd = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += chars[rnd[i] % chars.length];
  return s;
}

/** 假人密码表（持久化到 agent 目录 bot-passwords.json，重启不丢） */
function loadPasswords(bots) {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bot-passwords.json');
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { /* 首次运行 */ }
  let changed = false;
  for (const b of bots) {
    if (!saved[b.username]) {
      saved[b.username] = genPassword();
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(saved, null, 2));
  return saved;
}

const config = {
  backendWs: process.env.BACKEND_WS || 'ws://192.168.9.6:8000/ws/agents',
  agentId: process.env.AGENT_ID || 'agent-mtn',
  nodeName: process.env.NODE_NAME || 'mtn-node',
  version: '0.1.0',
  mcServer: process.env.MC_SERVER || '127.0.0.1',
  mcPort: parseInt(process.env.MC_PORT || '25565', 10),
  bots: JSON.parse(
    process.env.AGENT_BOTS ||
      JSON.stringify([
        { bot_id: 'bot-001', display_name: '农工一号', game_server: 'survival', username: 'BotFarmer1' },
        { bot_id: 'bot-002', display_name: '矿工二号', game_server: 'survival', username: 'BotMiner1' },
      ]),
  ),
  heartbeatMs: 10000,
  statusMs: 5000,
  // 假人密码表（首次运行自动生成，持久化在 bot-passwords.json）
  passwords: loadPasswords(JSON.parse(
    process.env.AGENT_BOTS ||
      JSON.stringify([
        { bot_id: 'bot-001', display_name: '农工一号', game_server: 'survival', username: 'BotFarmer1' },
        { bot_id: 'bot-002', display_name: '矿工二号', game_server: 'survival', username: 'BotMiner1' },
      ]),
  )),
  // 登录插件（AuthMe 等）自动登录命令（可选覆盖，默认随机密码自动注册/登录）
  loginCommands: process.env.BOT_LOGIN_COMMANDS
    ? JSON.parse(process.env.BOT_LOGIN_COMMANDS)
    : [],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 一个被遥控的 Minecraft 假人 */
class McBot {
  constructor(reg, agent) {
    this.reg = reg; // {bot_id, display_name, game_server, username}
    this.agent = agent;
    this.bot = null;
    this.status = 'offline'; // idle|running|paused|error|offline
    this.currentTaskId = null;
    this.step = 0;
    this.error = null;
    this._stopFlag = false;
    this._pauseFlag = false;
    this._taskLoop = null;
    this._authDone = false;
    this._authNeedsRegister = false;
    this._stopped = false;
    this.reg.password = config.passwords[this.reg.username] || '';
    this._recentMessages = []; // 断开调试：最近收到的服务器消息
  }

  async connect() {
    if (this._stopped) return;
    this.status = 'offline';
    this.bot = createBot({
      host: config.mcServer,
      port: config.mcPort,
      username: this.reg.username,
      // 服务器为 Folia 1.21.11（协议 774）。必须指定对应版本，
      // 之前误用 '26.1' 导致 update_time 崩溃和 chunk 解析失败。
      version: '1.21.11',
      auth: 'offline',
    });
    // loadPlugin(pathfinderPlugin) 在此版本组合下静默失败（bot.pathfinder 保持 undefined），
    // 手动 inject 已验证可用。
    // this.bot.loadPlugin(pathfinderPlugin);


    this.bot.once('login', () => {
      // 关键：登录后初始化 pathfinder（手动 inject + Movements，否则无法寻路）
      try {
        pathfinderPlugin(this.bot);
        const mcData = require('minecraft-data')(this.bot.version);
        this.bot.pathfinder.setMovements(new Movements(this.bot, mcData));
        this.bot.pathfinder.movements.canDig = false; // 寻路时不挖掘方块
        this.bot.pathfinder.movements.maxDropDown = 15; // 允许跳下 15 格（默认 4 格，高处平台会困死假人）
        this.bot.pathfinder.thinkTimeout = 15000; // A* 搜索超时 15s（默认 5s 远距离不够）
        this.log(`pathfinder 就绪 (${this.bot.version})`);
      } catch (err) {
        this.log(`pathfinder 初始化失败: ${err.message}`);
      }

      // 兼容补丁：mineflayer 4.37.1 的 time 插件解析 26.1 协议的 update_time
      // 包时 longToBigInt(undefined) 崩溃，导致假人断连/半死。login 后内置
      // 插件 handler 必然已注册，此时移除并接管，才能确保生效。
      try {
        this.bot._client.removeAllListeners('update_time');
        this.bot._client.on('update_time', (packet) => {
          try {
            const t = packet && packet.time;
            const a = packet && packet.age;
            if (Array.isArray(t) && t.length >= 2) {
              const time = (BigInt(t[1]) << 32n) | BigInt(t[0]);
              this.bot.time = {
                doDaylightCycle: time >= 0n,
                bigTime: time,
                time: Number(time),
                timeOfDay: Number(time % 24000n),
                day: Number(time / 24000n),
                isDay: Number(time % 24000n) >= 0 && Number(time % 24000n) < 13000,
              };
              if (Array.isArray(a) && a.length >= 2) {
                const age = (BigInt(a[1]) << 32n) | BigInt(a[0]);
                this.bot.time.bigAge = age;
                this.bot.time.age = Number(age);
              }
              this.bot.emit('time');
            }
          } catch {
            /* 解析失败忽略，保持连接 */
          }
        });
      } catch { /* ignore */ }

      this.status = 'idle';
      this.error = null;
      this.log(`假人 ${this.reg.username} 已登录 ${config.mcServer}:${config.mcPort}`);
      this.agent.sendStatus(this);
      this._startAuth();
    });
    this.bot.on('messagestr', (msg) => {
      // 监听服务器提示，识别登录插件状态
      const m = String(msg || '');
      this._recentMessages.push(m.slice(0, 200));
      if (this._recentMessages.length > 8) this._recentMessages.shift();
      if (this._msgCount === undefined) this._msgCount = 0;
      if (this._msgCount++ < 15) this.log(`服务器消息: ${m.slice(0, 120)}`);
      if (/register|注册|未注册/.test(m)) this._authNeedsRegister = true;
      if (/welcome|欢迎|成功|successfully|logged in/i.test(m)) this._authDone = true;
    });
    this.bot.on('error', (err) => {
      this.status = 'error';
      this.error = String(err.message || err).slice(0, 500);
      this.log(`假人错误: ${this.error}`);
      if (this._recentMessages.length) {
        this.log(`  断开前服务器消息: ${JSON.stringify(this._recentMessages.slice(-5))}`);
      }
      this.agent.sendStatus(this);
    });
    this.bot.on('kicked', (reason) => {
      const text = typeof reason === 'string' ? reason : JSON.stringify(reason) || '未知原因';
      this.status = 'error';
      this.error = `被服务器踢出: ${text}`.slice(0, 500);
      this.agent.sendStatus(this);
    });
    this.bot.on('end', () => {
      this._taskLoop = null;
      this.currentTaskId = null;
      this.step = 0;
      this.status = 'offline';
      // 被 removeBot 停止的假人不再重连
      if (this._stopped) {
        this.log('假人已停止（不再重连）');
        return;
      }
      this.log('假人连接断开，5 秒后自动重连...');
      this.agent.sendStatus(this);
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = setTimeout(() => this.connect(), 5000);
    });
  }

  /** 登录插件自动登录/注册（AuthMe 等） */
  async _startAuth() {
    // 自定义登录命令优先
    if (config.loginCommands.length > 0) {
      setTimeout(async () => {
        for (const cmd of config.loginCommands) {
          try {
            this.bot.chat(cmd);
            this.log(`发送登录命令: ${cmd}`);
          } catch (err) {
            this.log(`登录命令失败: ${cmd} (${err.message})`);
          }
          await sleep(1500);
        }
      }, 3000);
      return;
    }
    // 默认：随机密码自动登录；检测到未注册提示则自动注册
    if (!this.reg.password) return;
    setTimeout(async () => {
      if (this._authDone || this.status === 'offline') return;
      this.log(`自动登录: /login ${this.reg.password}`);
      try {
        this.bot.chat(`/login ${this.reg.password}`);
      } catch (err) {
        this.log(`登录命令失败: ${err.message}`);
        return;
      }
      await sleep(3000);
      if (this._authNeedsRegister && !this._authDone) {
        this.log(`检测到未注册，自动注册: /register ${this.reg.password} ${this.reg.password}`);
        try {
          this.bot.chat(`/register ${this.reg.password} ${this.reg.password}`);
        } catch (err) {
          this.log(`注册命令失败: ${err.message}`);
        }
      }
    }, 3000);
  }

  /** 处理后端命令 */
  async handleCommand(cmd) {
    const { id, type, task, params } = cmd;
    this.log(`收到命令: ${type}${task ? ` ${task}` : ''}`);
    if (type === 'run_task') {
      if (this._taskLoop) {
        this.agent.sendTaskResult(this, id, false, '该假人正在执行任务，先 stop 再派新任务');
        return;
      }
      this._stopFlag = false;
      this._pauseFlag = false;
      this.currentTaskId = id;
      this.status = 'running';
      this.step = 0;
      this.agent.sendStatus(this);
      this._taskLoop = this._runTask(id, task, params || {});
      return;
    }
    if (type === 'pause') {
      if (this.status === 'running') {
        this._pauseFlag = true;
        this.status = 'paused';
        this.agent.sendStatus(this);
      }
      return;
    }
    if (type === 'resume') {
      if (this.status === 'paused') {
        this._pauseFlag = false;
        this.status = 'running';
        this.agent.sendStatus(this);
      }
      return;
    }
    if (type === 'stop') {
      this._stopFlag = true;
      this._pauseFlag = false;
      // 强制中断寻路，否则卡住的 goto 会让任务协程永不退出
      try {
        this.bot?.pathfinder?.stop();
      } catch { /* ignore */ }
      if (this._taskLoop) {
        await this._taskLoop; // 等任务协程自己退出
        this._taskLoop = null;
      }
      this.currentTaskId = null;
      this.step = 0;
      this.status = this.bot?.entity ? 'idle' : 'offline';
      this.agent.sendStatus(this);
      this.agent.sendTaskResult(this, id, true); // success 时不带 error
      return;
    }
    if (type === 'screenshot') {
      // Mineflayer 无渲染画面；返回视角内实体清单作为“现场”信息
      const entities = this.bot?.entities
        ? Object.values(this.bot.entities).slice(0, 10).map((e) => `${e.name}@${e.position ? e.position.x.toFixed(0) + ',' + e.position.z.toFixed(0) : '?'}`)
        : [];
      this.agent.sendTaskResult(this, id, true, `screenshot 不可用(mineflayer)，视角内实体: ${entities.join(', ') || '无'}`);
      return;
    }
    if (type === 'inventory') {
      // 实时库存查询（后端 GET /bots/{id}/inventory 会等待 inventory_report）
      this.agent.sendInventoryReport(this);
      return;
    }
    this.agent.sendTaskResult(this, id, false, `未知命令类型 ${type}`);
  }

  /** 停止假人：断开 Minecraft 连接并清理定时器 */
  stop() {
    this._stopFlag = true;
    this._stopped = true;
    try {
      this.bot?.pathfinder?.stop();
    } catch { /* ignore */ }
    try {
      this.bot?.quit();
    } catch { /* ignore */ }
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this.bot = null;
    this.status = 'offline';
  }

  async _runTask(id, taskName, params) {
    const normalizedName = String(taskName || '').trim();
    const impl = TASKS[normalizedName];
    try {
      if (!impl) throw new Error(`未知任务 ${taskName}（可用: ${Object.keys(TASKS).join(', ')}）`);
      const ctx = {
        lib: { pathfinder: this.bot.pathfinder, Movements, goals },
        isStopped: () => this._stopFlag,
        isPaused: () => this._pauseFlag,
        wait: async (ms) => {
          const until = Date.now() + ms;
          while (Date.now() < until) {
            if (this._stopFlag) return;
            if (this._pauseFlag) {
              await sleep(200);
              continue;
            }
            await sleep(Math.min(100, until - Date.now()));
          }
        },
        reportStep: async (n, desc) => {
          this.step = n;
          this.agent.sendStatus(this, desc);
        },
      };
      await impl(this.bot, params, ctx);
      if (this._stopFlag) return;
      this.currentTaskId = null;
      this.step = 0;
      this.status = this.bot?.entity ? 'idle' : 'offline';
      this.agent.sendStatus(this);
      this.agent.sendTaskResult(this, id, true); // completed，无 error
    } catch (err) {
      this.currentTaskId = null;
      this.step = 0;
      this.status = this.bot?.entity ? 'idle' : 'error';
      this.error = String(err.message || err).slice(0, 500);
      this.agent.sendStatus(this);
      this.agent.sendTaskResult(this, id, false, this.error);
    } finally {
      this._taskLoop = null;
    }
  }

  log(msg) {
    console.log(`[${this.reg.bot_id}] ${msg}`);
  }
}

/** 与后端的 WebSocket 连接管理 */
class AgentConnection {
  constructor() {
    this.ws = null;
    this.registered = false;
    this.retryMs = 2000;
    this.bots = new Map();
    for (const reg of config.bots) {
      this.bots.set(reg.bot_id, new McBot(reg, this));
    }
  }

  connect() {
    this.log(`连接后端 ${config.backendWs} ...`);
    const ws = new WebSocket(config.backendWs, { handshakeTimeout: 8000 });
    this.ws = ws;

    ws.on('open', () => {
      this.retryMs = 2000;
      this.registered = false;
      this.sendRegister();
      // 心跳 + 状态定时器
      if (!this._hbTimer) {
        this._hbTimer = setInterval(() => this.sendHeartbeat(), config.heartbeatMs);
        this._stTimer = setInterval(() => {
          for (const bot of this.bots.values()) this.sendStatus(bot);
        }, config.statusMs);
      }
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'registered') {
        this.registered = true;
        this.log(`注册成功 agent_id=${msg.agent_id}，心跳超时 ${msg.heartbeat_timeout_seconds}s`);
        return;
      }
      if (msg.type === 'protocol_error') {
        this.log(`协议错误: ${JSON.stringify(msg.detail)}`);
        return;
      }
      // 命令消息：{id, type, bot_id, task?, params?}
      if (msg.id && msg.type && msg.bot_id) {
        // add_bot / remove_bot 由连接层处理（bot 可能还不存在 / 需要整体移除）
        if (msg.type === 'add_bot') {
          this.addBot(msg);
          return;
        }
        if (msg.type === 'remove_bot') {
          // 单向命令：bot 记录已从后端删除，回复 task_result 会因找不到 bot 触发 protocol_error
          this.removeBot(msg.bot_id);
          return;
        }
        const bot = this.bots.get(msg.bot_id);
        if (!bot) {
          this.sendTaskResult(msg.bot_id, msg.id, false, `未知 bot_id ${msg.bot_id}`);
          return;
        }
        bot.handleCommand(msg).catch((e) => this.log(`命令处理异常: ${e.message}`));
      }
    });

    ws.on('close', () => {
      this.log('连接断开，重连中...');
      this.registered = false;
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 30000);
    });

    ws.on('error', (err) => this.log(`WS 错误: ${err.message}`));
  }

  /** 动态添加假人（后端新建机器人后推送 add_bot 命令） */
  addBot(msg) {
    const p = msg.params || {};
    const botId = p.bot_id || msg.bot_id;
    if (this.bots.has(botId)) {
      this.sendTaskResult(botId, msg.id, false, `假人 ${botId} 已存在`);
      return;
    }
    const username = p.username || botId;
    if (!config.passwords[username]) {
      config.passwords[username] = genPassword();
      fs.writeFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), 'bot-passwords.json'),
        JSON.stringify(config.passwords, null, 2),
      );
    }
    const reg = {
      bot_id: botId,
      display_name: p.display_name || botId,
      game_server: p.game_server || 'survival',
      username,
    };
    const bot = new McBot(reg, this);
    this.bots.set(botId, bot);
    this.log(`动态创建假人 ${botId} (username=${username})，开始连接 Minecraft`);
    bot.connect();
    this.sendTaskResult(botId, msg.id, true);
  }

  /** 动态移除假人（后端删除机器人后推送 remove_bot 命令） */
  removeBot(botId) {
    const bot = this.bots.get(botId);
    if (bot) {
      bot.stop();
      this.bots.delete(botId);
      this.log(`已移除假人 ${botId}`);
    }
  }

  sendRegister() {
    this.ws.send(JSON.stringify({
      type: 'register',
      agent_id: config.agentId,
      node_name: config.nodeName,
      version: config.version,
      capabilities: ['mineflayer', 'pathfinder'],
      bots: [...this.bots.values()].map((b) => ({
        bot_id: b.reg.bot_id,
        display_name: b.reg.display_name,
        game_server: b.reg.game_server,
        status: b.status,
        metadata: {
          username: b.reg.username,
          engine: 'mineflayer',
          // 假人登录密码（随机生成，持久化；前端面板可见）
          password: b.reg.password || undefined,
        },
      })),
    }));
  }

  sendHeartbeat() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'heartbeat', agent_id: config.agentId }));
    }
  }

  sendStatus(bot, stepDesc) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.registered) return;
    const pos = bot.bot?.entity?.position;
    // 注意：后端 AgentStatusUpdate 是 strict 模型（extra=forbid），
    // 只能发送协议定义的字段，额外的 detail 会被拒收并断开连接。
    this.ws.send(JSON.stringify({
      type: 'status',
      bot_id: bot.reg.bot_id,
      status: bot.status,
      current_task_id: bot.currentTaskId,
      current_step: bot.step,
      hp: bot.bot ? bot.bot.health : null,
      position: pos ? `${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)} ${bot.bot.game?.dimension || ''}` : null,
      error: bot.error || undefined,
    }));
    if (stepDesc) this.log(`[${bot.reg.bot_id}] ${stepDesc}`);
  }

  sendTaskResult(botOrId, taskId, success, error) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const botId = typeof botOrId === 'string' ? botOrId : botOrId.reg.bot_id;
    this.ws.send(JSON.stringify({
      type: 'task_result',
      bot_id: botId,
      task_id: taskId,
      success,
      ...(error ? { error: String(error).slice(0, 2000) } : {}),
    }));
  }

  /** 上报假人背包（主背包 + 盔甲 + 副手 + 手持） */
  sendInventoryReport(bot) {
    this.log(`[${bot.reg.bot_id}] 尝试上报库存: ws=${this.ws ? this.ws.readyState : 'null'} registered=${this.registered}`);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.registered) return;
    const inv = bot.bot?.inventory;
    const items = [];
    try {
      if (inv) {
        for (const item of inv.items()) {
          items.push({
            slot: item.slot ?? -1, // mineflayer 部分物品 slot 可能为 undefined，必须兜底否则后端校验拒收
            name: item.name,
            display_name: item.displayName,
            count: item.count,
          });
        }
      }
    } catch { /* 库存不可用时返回空 */ }
    const armor = [];
    try {
      if (inv?.armor) {
        for (const item of inv.armor) {
          if (item) armor.push({ slot: item.slot ?? -1, name: item.name, display_name: item.displayName, count: item.count });
        }
      }
    } catch { /* ignore */ }
    let heldItem = null;
    try {
      const held = bot.bot?.heldItem;
      if (held) heldItem = { slot: held.slot ?? -1, name: held.name, display_name: held.displayName, count: held.count };
    } catch { /* ignore */ }
    let offhand = null;
    try {
      // mineflayer 玩家库存副手通常位于 45 号格
      const item = bot.bot?.inventory?.slots?.[45];
      if (item) offhand = { slot: 45, name: item.name, display_name: item.displayName, count: item.count };
    } catch { /* ignore */ }
    this.ws.send(JSON.stringify({
      type: 'inventory_report',
      bot_id: bot.reg.bot_id,
      items,
      armor,
      offhand,
      held_item: heldItem,
    }));
  }

  log(msg) {
    console.log(`[agent] ${msg}`);
  }
}

// ---------- 启动 ----------
const agent = new AgentConnection();
for (const bot of agent.bots.values()) {
  bot.connect();
}
agent.connect();
console.log(`MC Bot Agent 启动 | 后端=${config.backendWs} | MC=${config.mcServer}:${config.mcPort} | 假人=${config.bots.map((b) => b.username).join(', ')}`);
