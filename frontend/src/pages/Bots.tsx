import { AlertTriangle, ArrowUpRight, Bot, Plus, Search, Send, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BotCard } from '../components/bots/BotCard'
import { InventoryModal } from '../components/bots/InventoryModal'
import { BotStatusBadge } from '../components/common/StatusBadge'
import { createBot, deleteBot } from '../lib/api'
import { useControl } from '../lib/use-control'
import { eventLabel, eventSummary, relativeTime } from '../lib/presentation'
import type { BotStatus, BotView, CommandType } from '../types'

const filters: Array<{ value: BotStatus | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'running', label: '运行中' },
  { value: 'idle', label: '空闲' },
  { value: 'paused', label: '已暂停' },
  { value: 'error', label: '错误' },
  { value: 'stuck', label: '卡住' },
  { value: 'offline', label: '离线' },
]

export function Bots() {
  const { bots, events, issueCommand, refresh, error: globalError, loading } = useControl()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filter, setFilter] = useState<BotStatus | 'all'>('all')
  const [query, setQuery] = useState('')
  const [busyBotId, setBusyBotId] = useState<string | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [taskTarget, setTaskTarget] = useState<BotView | null>(null)
  const [inventoryTarget, setInventoryTarget] = useState<BotView | null>(null)
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null)
  const [showAddBot, setShowAddBot] = useState(false)
  const closeTaskModal = useCallback(() => setTaskTarget(null), [])
  const showToast = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    setToast({ message, kind })
    window.setTimeout(() => setToast(null), 4000)
  }, [])
  const selectedId = searchParams.get('selected')
  const selectedBot = bots.find((bot) => bot.bot_id === selectedId) || null

  useEffect(() => {
    if (selectedId && !selectedBot) setSearchParams({}, { replace: true })
  }, [selectedBot, selectedId, setSearchParams])

  const filteredBots = useMemo(() => bots.filter((bot) => {
    const matchesFilter = filter === 'all' || bot.status === filter
    const needle = query.trim().toLowerCase()
    const matchesSearch = !needle || [bot.displayName, bot.bot_id, bot.agentName, bot.game_server || '']
      .some((value) => value.toLowerCase().includes(needle))
    return matchesFilter && matchesSearch
  }), [bots, filter, query])

  const runCommand = async (bot: BotView, type: CommandType) => {
    setBusyBotId(bot.bot_id)
    setCommandError(null)
    try {
      await issueCommand(bot.bot_id, { type })
    } catch (commandError) {
      setCommandError(toMessage(commandError))
    } finally {
      setBusyBotId(null)
    }
  }

  const selectBot = (bot: BotView) => setSearchParams({ selected: bot.bot_id })

  const handleDeleteBot = async (bot: BotView) => {
    if (!window.confirm(`确定删除机器人「${bot.displayName}」？\n游戏内假人连接会被断开，且无法撤销。`)) return
    setCommandError(null)
    try {
      await deleteBot(bot.bot_id)
      if (selectedBot?.bot_id === bot.bot_id) setSearchParams({})
      showToast(`已删除 ${bot.displayName}`, 'success')
      void refresh()
    } catch (deleteError) {
      setCommandError(toMessage(deleteError))
    }
  }

  return (
    <div className="page-stack">
      {globalError ? <div className="inline-notice error"><AlertTriangle size={17} /> {globalError}</div> : null}
      {commandError ? <div className="inline-notice error"><AlertTriangle size={17} /> {commandError}</div> : null}
      <section className="toolbar-row">
        <label className="search-control">
          <Search size={17} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索机器人或节点" aria-label="搜索机器人或节点" />
        </label>
        <div className="filter-tabs" role="tablist" aria-label="机器人状态筛选">
          {filters.map((item) => (
            <button key={item.value} role="tab" aria-selected={filter === item.value} className={filter === item.value ? 'is-active' : ''} onClick={() => setFilter(item.value)}>
              {item.label}
            </button>
          ))}
        </div>
        <button className="command-button primary add-bot-button" type="button" onClick={() => setShowAddBot(true)}>
          <Plus size={15} /> 添加机器人
        </button>
      </section>

      {loading ? <BotsSkeleton /> : (
        <div className="bots-workbench">
          <section className="bot-grid" aria-live="polite">
            {filteredBots.length ? filteredBots.map((bot) => (
              <BotCard
                key={bot.bot_id}
                bot={bot}
                busy={busyBotId === bot.bot_id}
                onSelect={() => selectBot(bot)}
                onCommand={(type) => void runCommand(bot, type)}
                onRunTask={() => setTaskTarget(bot)}
                onOpenInventory={() => setInventoryTarget(bot)}
                onDelete={() => void handleDeleteBot(bot)}
              />
            )) : <div className="empty-block wide"><span><Bot size={22} /></span><p>没有符合筛选条件的机器人</p></div>}
          </section>
          <BotInspector bot={selectedBot} events={events} onClose={() => setSearchParams({})} onRunTask={() => selectedBot && setTaskTarget(selectedBot)} onDelete={handleDeleteBot} />
        </div>
      )}

      {taskTarget ? <TaskModal bot={taskTarget} onClose={closeTaskModal} /> : null}
      {inventoryTarget ? (
        <InventoryModal
          botId={inventoryTarget.bot_id}
          botName={inventoryTarget.displayName}
          onClose={() => setInventoryTarget(null)}
          onToast={showToast}
        />
      ) : null}
      {showAddBot ? (
        <AddBotModal
          onClose={() => setShowAddBot(false)}
          onCreated={() => {
            setShowAddBot(false)
            showToast('机器人已添加，正在连接 Minecraft…', 'success')
            void refresh()
          }}
          onError={(message) => showToast(message, 'error')}
        />
      ) : null}
      {toast ? <div className={`inventory-toast ${toast.kind}`}>{toast.message}</div> : null}
    </div>
  )
}

function BotInspector({ bot, events, onClose, onRunTask, onDelete }: { bot: BotView | null; events: ReturnType<typeof useControl>['events']; onClose: () => void; onRunTask: () => void; onDelete: (bot: BotView) => void }) {
  if (!bot) {
    return <aside className="inspector empty-inspector"><ArrowUpRight size={20} /><p>选择一个机器人查看详情和近期事件</p></aside>
  }
  const botEvents = events.filter((event) => event.payload.bot_id === bot.bot_id).slice(0, 8)
  return (
    <aside className="inspector">
      <div className="inspector-header">
        <div><span>机器人详情</span><h2>{bot.displayName}</h2></div>
        <div className="inspector-header-actions">
          <button className="icon-button danger-icon" aria-label="删除机器人" title="删除机器人" onClick={() => onDelete(bot)}><Trash2 size={15} /></button>
          <button className="icon-button" aria-label="关闭详情" title="关闭详情" onClick={onClose}><X size={16} /></button>
        </div>
      </div>
      <div className="inspector-status"><BotStatusBadge status={bot.status} /><span>{bot.bot_id}</span></div>
      <dl className="inspector-facts">
        <div><dt>执行节点</dt><dd>{bot.agentName}</dd></div>
        <div><dt>区服</dt><dd>{bot.game_server || '未上报'}</dd></div>
        <div><dt>当前任务</dt><dd>{bot.current_task_id || '无'}</dd></div>
        <div><dt>当前步骤</dt><dd>{bot.current_step === null ? '未上报' : bot.current_step}</dd></div>
        <div><dt>位置</dt><dd>{bot.position || '未上报'}</dd></div>
        <div><dt>生命值</dt><dd>{bot.hp === null ? '未上报' : `${bot.hp}`}</dd></div>
      </dl>
      {bot.error ? <div className="bot-error"><AlertTriangle size={16} /> {bot.error}</div> : null}
      <button className="command-button primary full" onClick={onRunTask} disabled={bot.status === 'offline'}><Send size={14} /> 下发任务</button>
      <div className="inspector-events"><h3>近期事件</h3>{botEvents.length ? botEvents.map((event) => <article key={event.id}><span>{eventLabel(event.type)}</span><p>{eventSummary(event)}</p><time>{relativeTime(event.occurred_at)}</time></article>) : <p className="muted-copy">该机器人尚无事件记录</p>}</div>
    </aside>
  )
}

function TaskModal({ bot, onClose }: { bot: BotView; onClose: () => void }) {
  const { issueCommand } = useControl()
  const modalRef = useRef<HTMLFormElement>(null)
  const taskInputRef = useRef<HTMLInputElement>(null)
  const [task, setTask] = useState('')
  const [paramsText, setParamsText] = useState('{}')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const modal = modalRef.current
    taskInputRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !modal) return

      const focusable = Array.from(modal.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.offsetParent !== null)
      if (!focusable.length) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (opener?.isConnected) opener.focus()
    }
  }, [onClose])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    let params: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(paramsText || '{}')
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('参数必须是 JSON 对象')
      params = parsed as Record<string, unknown>
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : '参数格式无效')
      return
    }
    setSubmitting(true)
    try {
      const command = await issueCommand(bot.bot_id, { type: 'run_task', task, params })
      setSuccess(`命令 ${command.id} 已发送`)
    } catch (commandError) {
      setError(toMessage(commandError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form ref={modalRef} className="command-modal" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading"><div><p>下发任务到</p><h2 id="task-dialog-title">{bot.displayName}</h2></div><button className="icon-button" type="button" aria-label="关闭任务窗口" title="关闭" onClick={onClose}><X size={16} /></button></div>
        <label className="field-label">任务名称<input ref={taskInputRef} value={task} onChange={(event) => setTask(event.target.value)} placeholder="例如 daily_login" required /></label>
        <label className="field-label">参数 JSON<textarea value={paramsText} onChange={(event) => setParamsText(event.target.value)} rows={5} spellCheck={false} /></label>
        {error ? <p className="form-message error">{error}</p> : null}
        {success ? <p className="form-message success">{success}</p> : null}
        <div className="modal-actions"><button type="button" className="command-button" onClick={onClose}>取消</button><button type="submit" className="command-button primary" disabled={submitting || !task.trim()}><Send size={14} />{submitting ? '发送中' : '发送任务'}</button></div>
      </form>
    </div>
  )
}

function BotsSkeleton() {
  return <div className="bots-workbench"><div className="bot-grid">{Array.from({ length: 6 }, (_, index) => <div className="skeleton bot-skeleton" key={index} />)}</div><div className="skeleton inspector-skeleton" /></div>
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : '命令发送失败'
}

function AddBotModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void
  onCreated: () => void
  onError: (message: string) => void
}) {
  const [gameName, setGameName] = useState('')
  const [gameServer, setGameServer] = useState('survival')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = gameName.trim()
    if (!name) return
    setSubmitting(true)
    try {
      // 游戏内名字就是 bot_id/display_name，避免面板名称与真实假人名称不一致
      await createBot({ bot_id: name, display_name: name, game_server: gameServer })
      onCreated()
    } catch (error) {
      onError(toMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="command-modal add-bot-modal" role="dialog" aria-modal="true" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading"><div><p>注册一个新的假人</p><h2>添加机器人</h2></div><button className="icon-button" type="button" aria-label="关闭" title="关闭" onClick={onClose}><X size={16} /></button></div>
        <label className="field-label">游戏内名字<input value={gameName} onChange={(event) => setGameName(event.target.value)} placeholder="例如 BotFarmer2" required autoFocus /></label>
        <p className="field-hint add-bot-hint">机器人 ID 和显示名称会自动使用这个游戏内名字，创建后执行代理会自动连接 Minecraft 并注册假人。</p>
        <label className="field-label">区服标识<input value={gameServer} onChange={(event) => setGameServer(event.target.value)} placeholder="survival" /></label>
        <div className="modal-actions"><button type="button" className="command-button" onClick={onClose}>取消</button><button type="submit" className="command-button primary" disabled={submitting || !gameName.trim()}><Plus size={14} />{submitting ? '添加中' : '添加机器人'}</button></div>
      </form>
    </div>
  )
}
