/**
 * 任务注册表：把后端的 task 名映射到 Mineflayer 动作。
 * 每个任务函数签名：async (bot, params, ctx) => void
 *   - bot:    mineflayer Bot 实例
 *   - params: 后端下发命令里的 params 对象
 *   - ctx: 执行上下文，提供
 *       lib        = { pathfinder, Movements, goals }  （Mineflayer 路径查找）
 *       isStopped()   是否收到 stop
 *       isPaused()    是否收到 pause
 *       wait(ms)      休眠（暂停时阻塞等待恢复）
 *       reportStep(n, desc)  上报进度
 */

async function daily_login(bot, params, ctx) {
  // 每日登录打卡：进服后报个到，走动两步
  await ctx.reportStep(1, '登录进服');
  bot.chat('!daily');
  await ctx.wait(1500);
  await ctx.reportStep(2, '打卡完成');
  await ctx.wait(1000);
}

async function explore(bot, params, ctx) {
  // 随机探索：朝随机方向走一段（每次寻路带超时，避免卡死）
  const { pathfinder, goals } = ctx.lib;
  const range = params.range || 60;
  const timeoutMs = params.timeout_ms || 20000;
  for (let i = 0; i < (params.loops || 2); i++) {
    if (ctx.isStopped()) return;
    const x = bot.entity.position.x + (Math.random() * 2 - 1) * range;
    const z = bot.entity.position.z + (Math.random() * 2 - 1) * range;
    await ctx.reportStep(i + 1, `探索到 ${x.toFixed(0)}, ${z.toFixed(0)}`);
    try {
      await Promise.race([
        pathfinder.goto(new goals.GoalXZ(x, z)),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`寻路超时(${timeoutMs}ms)`)), timeoutMs)),
      ]);
    } catch (err) {
      bot.pathfinder?.stop();
      throw err; // 超时/寻路失败：任务失败并上报，避免永远 running
    }
  }
}

async function follow_player(bot, params, ctx) {
  // 跟随指定玩家（params.player），直到 stop
  const { pathfinder, goals } = ctx.lib;
  const targetName = params.player || (bot.players && Object.keys(bot.players)[0]);
  if (!targetName) throw new Error('follow_player 需要 params.player 或服务器里有人');
  while (!ctx.isStopped()) {
    const target = bot.players[targetName]?.entity;
    if (target) {
      await pathfinder.goto(new goals.GoalFollow(target, 2), true);
    }
    await ctx.wait(1500);
  }
}

async function farm_wheat(bot, params, ctx) {
  // 简化版种田：找到最近的小麦方块并收获（循环 max_blocks 次）
  const { pathfinder, goals } = ctx.lib;
  const maxBlocks = params.max_blocks || 8;
  const limit = params.limit || 24; // 找方块的最大距离
  let harvested = 0;
  while (harvested < maxBlocks && !ctx.isStopped()) {
    const wheat = bot.findBlock({
      matching: (b) => b.name === 'wheat' && b.metadata === 7, // 成熟小麦
      maxDistance: limit,
    });
    if (!wheat) {
      bot.chat('附近没有成熟小麦了');
      break;
    }
    await ctx.reportStep(harvested + 1, `收获小麦 @ ${wheat.position}`);
    const p = wheat.position;
    await pathfinder.goto(new goals.GoalBlock(p.x, p.y, p.z));
    await bot.dig(wheat);
    harvested++;
    await ctx.wait(500);
  }
}

async function say_hello(bot, params, ctx) {
  bot.chat(`大家好，我是 ${bot.username}！`);
  await ctx.wait(800);
}

/** 解析坐标参数："x y z" 字符串 或 {x,y,z} 对象 */
function parsePosition(value) {
  if (!value) return null;
  if (typeof value === 'object') {
    const x = Number(value.x);
    const y = Number(value.y ?? value.y ?? 64);
    const z = Number(value.z);
    if (![x, y, z].some(Number.isNaN)) return { x, y, z };
    return null;
  }
  const parts = String(value).trim().split(/[\s,]+/).map(Number);
  if (parts.length >= 3 && !parts.slice(0, 3).some(Number.isNaN)) {
    return { x: parts[0], y: parts[1], z: parts[2] };
  }
  return null;
}

/** 带超时的寻路（避免卡死）；到达目标附近也算成功 */
async function gotoWithTimeout(bot, pathfinder, goals, goal, timeoutMs = 30000) {
  const start = bot.entity.position.clone();
  try {
    await Promise.race([
      pathfinder.goto(goal),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`寻路超时(${timeoutMs}ms)`)), timeoutMs)),
    ]);
  } catch (err) {
    bot.pathfinder?.stop();
    // 已接近目标（< 3 格）视为成功
    const cur = bot.entity.position;
    const dist = cur ? cur.distanceTo(start) : 0;
    const goalNear = goal instanceof goals.GoalXZ || goal instanceof goals.GoalBlock;
    if (goalNear && dist < 3 && err.message === `寻路超时(${timeoutMs}ms)`) return;
    throw err;
  }
}

/** 分段寻路：长距离拆成多段，每段重新等 chunk + 寻路（避免一次 A* 超时/前方 chunk 缺失） */
async function gotoBySegments(bot, pathfinder, goals, target, ctx, segLen = 25, timeoutMs = 45000) {
  const cur = bot.entity.position;
  const dx = target.x - cur.x;
  const dz = target.z - cur.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < segLen) {
    await gotoWithTimeout(bot, pathfinder, goals, new goals.GoalNear(target.x, target.y, target.z, 1), timeoutMs);
    return;
  }
  const segs = Math.ceil(dist / segLen);
  for (let i = 1; i <= segs; i++) {
    if (ctx?.isStopped?.()) return;
    const f = i / segs;
    const px = cur.x + dx * f;
    const pz = cur.z + dz * f;
    try { await bot.waitForChunksToLoad(5000); } catch { /* 超时继续 */ }
    await gotoWithTimeout(bot, pathfinder, goals, new goals.GoalNear(px, target.y, pz, 1), timeoutMs);
  }
}

async function move_to(bot, params, ctx) {
  // 移动到指定坐标（AI 调度最常用）
  const { pathfinder, goals } = ctx.lib;
  const pos = parsePosition(params.target_position || params.target || params.position || params.coordinates);
  if (!pos) throw new Error('move_to 需要坐标参数（如 params.target_position="x y z"）');
  try {
    await bot.waitForChunksToLoad(10000);
  } catch { /* 超时继续尝试 */ }
  await ctx.reportStep(1, `移动到 ${pos.x}, ${pos.y}, ${pos.z}`);
  await gotoBySegments(bot, pathfinder, goals, pos, ctx, params.segment || 25, params.timeout_ms || 45000);
}

async function patrol(bot, params, ctx) {
  // 移动到目标点后小范围巡逻
  const { pathfinder, goals } = ctx.lib;
  const pos = parsePosition(params.target_position || params.target || params.position || params.coordinates);
  if (!pos) throw new Error('patrol 需要坐标参数（如 params.target_position="x y z"）');
  try {
    await bot.waitForChunksToLoad(10000);
  } catch { /* 超时继续尝试 */ }
  await ctx.reportStep(1, `前往巡逻点 ${pos.x}, ${pos.y}, ${pos.z}`);
  await gotoBySegments(bot, pathfinder, goals, pos, ctx, params.segment || 25, params.timeout_ms || 45000);
  const radius = params.radius || 10;
  const loops = params.loops || 3;
  for (let i = 0; i < loops; i++) {
    if (ctx.isStopped()) return;
    const angle = Math.random() * Math.PI * 2;
    const x = pos.x + Math.cos(angle) * radius;
    const z = pos.z + Math.sin(angle) * radius;
    await ctx.reportStep(i + 2, `巡逻到 ${x.toFixed(0)}, ${z.toFixed(0)}`);
    await gotoWithTimeout(bot, pathfinder, goals, new goals.GoalXZ(x, z), params.timeout_ms || 45000);
  }
}

async function toss_item(bot, params, ctx) {
  // 扔物品：params.item = 物品名（如 "diamond"）或 display_name，params.count = 数量
  const itemName = params.item || params.item_name || params.name;
  const count = parseInt(params.count ?? params.amount ?? 1, 10);
  if (!itemName) throw new Error('toss_item 需要 item 参数（物品名，如 "diamond"）');
  const item = bot.inventory.items().find((i) => i.name === itemName || i.displayName === itemName);
  if (!item) throw new Error(`背包里没有 ${itemName}`);
  const tossCount = Math.min(count, item.count);
  if (tossCount <= 0) throw new Error(`无效数量 ${count}`);
  // mineflayer 4.x 部分版本 item.type 可能缺失，用 slot 里的实际物品兜底
  const slotItem = bot.inventory.slots[item.slot] || item;
  const type = slotItem.type ?? slotItem.id ?? item.type;
  console.log(`[debug] toss: name=${slotItem.name} type=${type} count=${tossCount}`);
  // 注意：mineflayer toss 签名是 toss(itemType, metadata, count)，别把 count 传成 metadata
  await bot.toss(type, null, tossCount);
  await ctx.reportStep(1, `扔出 ${tossCount} 个 ${item.displayName || itemName}`);
}

async function move_item(bot, params, ctx) {
  // 移动背包物品；45 是 Minecraft 副手槽，使用 equip/unequip 才能正确触发副手操作
  const from = parseInt(params.from_slot ?? params.from, 10);
  const to = parseInt(params.to_slot ?? params.to, 10);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw new Error('move_item 需要 from_slot 和 to_slot（背包格子号）');
  }
  const item = bot.inventory.slots[from];
  if (!item) throw new Error(`格子 ${from} 是空的`);
  if (to === 45) {
    await bot.equip(item, 'off-hand');
  } else if (from === 45) {
    await bot.unequip('off-hand');
    if (to !== 36) {
      const moved = bot.inventory.slots[36];
      if (moved && moved.slot === 36) await bot.moveSlotItem(36, to);
    }
  } else {
    await bot.moveSlotItem(from, to);
  }
  await ctx.reportStep(1, `移动 ${item.displayName || item.name} ${from} → ${to === 45 ? '副手' : to}`);
}

async function stop_task(bot, params, ctx) {
  bot.chat('任务已停止');
  await ctx.wait(300);
}

async function debug_move(bot, params, ctx) {
  // 调试：手动按键向前走 4 秒（不依赖 pathfinder）
  bot.setControlState('forward', true);
  bot.setControlState('jump', true);
  await ctx.wait(4000);
  bot.setControlState('forward', false);
  bot.setControlState('jump', false);
  await ctx.wait(500);
}

async function debug_surroundings(bot, params, ctx) {
  // 调试：报告当前位置、周围方块、chunk 加载状态
  const pos = bot.entity.position;
  console.log(`[debug] 位置: ${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)}`);
  console.log(`[debug] 脚下方块: ${bot.blockAt(pos)?.name} | 下方: ${bot.blockAt(pos.offset(0, -1, 0))?.name}`);
  // 向下探测：平台离地多高
  let groundY = null;
  for (let dy = 0; dy <= 30; dy++) {
    const b = bot.blockAt(pos.offset(0, -dy, 0));
    if (b && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air') {
      groundY = pos.y - dy + 1;
      console.log(`[debug] 下方第${dy}格是 ${b.name} (y=${(pos.y - dy).toFixed(0)})`);
      break;
    }
  }
  console.log(`[debug] 平台离地高度: ${groundY === null ? '30+ 格（未知）' : (pos.y - groundY).toFixed(0) + ' 格'}`);
  // 周围 3x3 方块
  for (let dx = -2; dx <= 2; dx++) {
    const row = [];
    for (let dz = -2; dz <= 2; dz++) {
      const b = bot.blockAt(pos.offset(dx, 0, dz));
      row.push(b ? b.name.slice(0, 10) : '??');
    }
    console.log(`[debug] y=${pos.y.toFixed(0)} x+${dx}: ${row.join(' | ')}`);
  }
  // 玩家周围 chunk 是否加载
  const cx = Math.floor(pos.x / 16), cz = Math.floor(pos.z / 16);
  const cols = bot.world?.getColumns?.() || [];
  const loaded = cols.filter(c => Math.abs(Number(c.chunkX) - cx) <= 2 && Math.abs(Number(c.chunkZ) - cz) <= 2).length;
  console.log(`[debug] 当前chunk (${cx},${cz}) | 附近2格内已加载: ${loaded} | 总chunk: ${cols.length}`);
  // 尝试简单寻路 5 格
  try {
    const { pathfinder, goals } = ctx.lib;
    const t = pos.offset(5, 0, 0);
    await ctx.reportStep(1, `测试寻路到 ${t.x.toFixed(0)}, ${t.z.toFixed(0)}`);
    await gotoWithTimeout(bot, pathfinder, goals, new goals.GoalNear(t.x, t.y, t.z, 1), 15000);
    const after = bot.entity.position;
    console.log(`[debug] 5格寻路后: ${after.x.toFixed(1)} ${after.y.toFixed(1)} ${after.z.toFixed(1)} 位移=${after.distanceTo(pos).toFixed(2)}`);
  } catch (e) {
    console.log(`[debug] 5格寻路失败: ${e.message}`);
  }
}

/** 任务名 → 实现。自定义任务在这里加一行即可。 */
export const TASKS = {
  daily_login,
  explore,
  follow_player,
  farm_wheat,
  say_hello,
  stop_task,
  patrol,
  move_to,
  debug_move,
  debug_surroundings,
  toss_item,
  move_item,
  // 中文别名：AI 可能生成中文任务名，映射到同一实现
  '移动到指定坐标': move_to,
  '移动': move_to,
  '巡逻': patrol,
  '种小麦': farm_wheat,
  '探索': explore,
  '跟随玩家': follow_player,
  '打招呼': say_hello,
  '停止': stop_task,
  '扔物品': toss_item,
  '扔': toss_item,
  '丢弃': toss_item,
  '移动物品': move_item,
};
