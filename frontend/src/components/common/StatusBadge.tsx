import type { BotStatus } from '../../types'

const labels: Record<BotStatus, string> = {
  idle: '空闲',
  running: '运行中',
  paused: '已暂停',
  error: '错误',
  stuck: '卡住',
  offline: '离线',
}

export function BotStatusBadge({ status }: { status: BotStatus }) {
  return <span className={`status-badge ${status}`}>{labels[status]}</span>
}
