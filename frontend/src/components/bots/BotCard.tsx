import { Box, Camera, Pause, Play, Square, Trash2 } from 'lucide-react'
import type { BotView, CommandType } from '../../types'
import { BotStatusBadge } from '../common/StatusBadge'

interface BotCardProps {
  bot: BotView
  busy?: boolean
  onSelect: () => void
  onCommand: (type: CommandType) => void
  onRunTask: () => void
  onOpenInventory: () => void
  onDelete: () => void
}

function timeLabel(timestamp: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000))
  if (seconds < 60) return '刚刚更新'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前更新`
  return `${Math.floor(seconds / 3600)} 小时前更新`
}

export function BotCard({ bot, busy = false, onSelect, onCommand, onRunTask, onOpenInventory, onDelete }: BotCardProps) {
  const control = bot.status === 'running'
    ? { type: 'pause' as const, label: '暂停', icon: Pause }
    : bot.status === 'paused'
      ? { type: 'resume' as const, label: '继续', icon: Play }
      : null
  const ControlIcon = control?.icon

  return (
    <article className={`bot-card ${bot.status}`}>
      <button className="bot-card-main" onClick={onSelect}>
        <div className="bot-card-header">
          <div>
            <h2>{bot.displayName}</h2>
            <p>{bot.bot_id}</p>
          </div>
          <BotStatusBadge status={bot.status} />
        </div>

        <dl className="bot-facts">
          <div><dt>节点</dt><dd>{bot.agentName}</dd></div>
          <div><dt>任务</dt><dd>{bot.current_task_id || '未分配'}</dd></div>
          <div><dt>位置</dt><dd>{bot.position || '未上报'}</dd></div>
          <div><dt>状态</dt><dd>{bot.current_step === null ? timeLabel(bot.updated_at) : `执行步骤 ${bot.current_step}`}</dd></div>
          {bot.metadata?.password ? (
            <div><dt>登录密码</dt><dd className="bot-password" title="登录插件（AuthMe 等）自动登录密码">{String(bot.metadata.password)}</dd></div>
          ) : null}
        </dl>
      </button>

      <div className="bot-card-actions">
        <button className="command-button primary" onClick={onRunTask} disabled={busy || bot.status === 'offline'}>
          <Play size={14} strokeWidth={2} /> 下发任务
        </button>
        {control && ControlIcon ? (
          <button className="icon-button" title={control.label} aria-label={control.label} onClick={() => onCommand(control.type)} disabled={busy}>
            <ControlIcon size={16} strokeWidth={1.8} />
          </button>
        ) : null}
        <button className="icon-button" title="查看库存" aria-label="查看库存" onClick={onOpenInventory} disabled={bot.status === 'offline'}>
          <Box size={16} strokeWidth={1.8} />
        </button>
        <button className="icon-button" title="请求截图" aria-label="请求截图" onClick={() => onCommand('screenshot')} disabled={busy || bot.status === 'offline'}>
          <Camera size={16} strokeWidth={1.8} />
        </button>
        <button className="icon-button danger" title="停止" aria-label="停止" onClick={() => onCommand('stop')} disabled={busy || bot.status === 'offline'}>
          <Square size={16} strokeWidth={1.8} />
        </button>
        <button className="icon-button danger-icon" title="删除机器人" aria-label="删除机器人" onClick={onDelete}>
          <Trash2 size={15} strokeWidth={1.8} />
        </button>
      </div>
    </article>
  )
}
