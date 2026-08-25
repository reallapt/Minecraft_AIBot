import type { BotView, DerivedAlert, EventEnvelope, NodeSummary } from '../types'

export function relativeTime(timestamp: string): string {
  const difference = Math.max(0, Date.now() - new Date(timestamp).getTime())
  const minutes = Math.floor(difference / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    'agent.registered': '节点已注册',
    'agent.disconnected': '节点已断开',
    'bot.registered': '机器人已注册',
    'bot.updated': '机器人状态更新',
    'command.dispatched': '命令已下发',
    'task.completed': '任务完成',
    'task.failed': '任务失败',
  }
  return labels[type] || type
}

export function eventSummary(event: EventEnvelope): string {
  const payload = event.payload
  const botId = stringValue(payload.bot_id)
  const agentId = stringValue(payload.agent_id)
  const task = stringValue(payload.task)

  if (event.type === 'command.dispatched') {
    return `${botId || '机器人'} 已接收 ${task || '控制'} 命令`
  }
  if (event.type === 'task.completed') return `${botId || '机器人'} 已完成任务`
  if (event.type === 'task.failed') return `${botId || '机器人'} 的任务执行失败`
  if (event.type === 'agent.registered') return `${agentId || '执行节点'} 已连接`
  if (event.type === 'agent.disconnected') return `${agentId || '执行节点'} 已断开`
  if (event.type === 'bot.updated') return `${botId || '机器人'} 已上报最新状态`
  if (event.type === 'bot.registered') return `${botId || '机器人'} 已注册到控制台`
  return '系统事件已记录'
}

export function deriveNodes(bots: BotView[]): NodeSummary[] {
  const grouped = new Map<string, BotView[]>()
  bots.forEach((bot) => {
    const key = bot.agent_id || 'unassigned'
    grouped.set(key, [...(grouped.get(key) || []), bot])
  })

  return [...grouped.entries()].map(([id, nodeBots]) => ({
    id,
    botCount: nodeBots.length,
    runningCount: nodeBots.filter((bot) => bot.status === 'running').length,
    onlineCount: nodeBots.filter((bot) => bot.status !== 'offline').length,
    latestUpdate: nodeBots.map((bot) => bot.updated_at).sort().at(-1) || null,
  })).sort((first, second) => second.onlineCount - first.onlineCount || first.id.localeCompare(second.id))
}

export function deriveAlerts(bots: BotView[], events: EventEnvelope[]): DerivedAlert[] {
  const botAlerts = bots
    .filter((bot) => bot.status === 'error' || bot.status === 'stuck')
    .map((bot) => ({
      id: `status-${bot.bot_id}-${bot.updated_at}`,
      level: 'error' as const,
      title: bot.status === 'stuck' ? '机器人卡住' : '机器人错误',
      message: bot.error || `${bot.displayName} 需要人工检查`,
      botId: bot.bot_id,
      occurredAt: bot.updated_at,
    }))

  const taskAlerts = events
    .filter((event) => event.type === 'task.failed')
    .map((event) => ({
      id: event.id,
      level: 'warning' as const,
      title: '任务执行失败',
      message: stringValue(event.payload.error) || eventSummary(event),
      botId: stringValue(event.payload.bot_id) || '未知机器人',
      occurredAt: event.occurred_at,
    }))

  return [...botAlerts, ...taskAlerts]
    .sort((first, second) => second.occurredAt.localeCompare(first.occurredAt))
    .filter((alert, index, all) => all.findIndex((candidate) => candidate.id === alert.id) === index)
}

export function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}
