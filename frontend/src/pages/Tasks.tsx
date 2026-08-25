import { AlertTriangle, CheckCircle2, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useControl } from '../lib/use-control'
import { eventLabel, eventSummary, relativeTime } from '../lib/presentation'

export function Tasks() {
  const { bots, events, issueCommand, error: globalError } = useControl()
  const eligibleBots = useMemo(() => bots.filter((bot) => bot.status !== 'offline'), [bots])
  const [botId, setBotId] = useState('')
  const [task, setTask] = useState('')
  const [paramsText, setParamsText] = useState('{}')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const commandEvents = events.filter((event) => event.type === 'command.dispatched' || event.type === 'task.completed' || event.type === 'task.failed')

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)
    setError(null)
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
      const command = await issueCommand(botId, { type: 'run_task', task, params })
      setMessage(`命令 ${command.id} 已发送到代理`)
      setTask('')
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : '任务下发失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-stack">
      <div className="inline-notice"><AlertTriangle size={17} /> 当前后端会将任务直接发送到代理。队列、重试和模板库将在调度服务接入后显示。</div>
      {globalError ? <div className="inline-notice error"><AlertTriangle size={17} /> {globalError}</div> : null}
      <div className="command-layout">
        <section className="surface-panel task-form-panel">
          <div className="panel-heading"><div><span className="panel-kicker"><Send size={15} /> 任务命令</span><h2>向机器人下发脚本</h2></div></div>
          <form className="command-form" onSubmit={submit}>
            <label className="field-label">目标机器人<select value={botId} onChange={(event) => setBotId(event.target.value)} required><option value="">选择已连接机器人</option>{eligibleBots.map((bot) => <option key={bot.bot_id} value={bot.bot_id}>{bot.displayName} ({bot.status})</option>)}</select></label>
            <label className="field-label">任务名称<input value={task} onChange={(event) => setTask(event.target.value)} placeholder="例如 daily_login" required /></label>
            <label className="field-label">参数 JSON<textarea value={paramsText} onChange={(event) => setParamsText(event.target.value)} rows={7} spellCheck={false} /></label>
            {error ? <p className="form-message error">{error}</p> : null}
            {message ? <p className="form-message success"><CheckCircle2 size={16} /> {message}</p> : null}
            <button className="command-button primary" type="submit" disabled={!botId || !task.trim() || submitting}><Send size={15} />{submitting ? '发送中' : '发送任务'}</button>
          </form>
        </section>
        <section className="surface-panel event-panel">
          <div className="panel-heading"><div><span className="panel-kicker"><Send size={15} /> 执行回执</span><h2>最新命令</h2></div></div>
          {commandEvents.length ? <div className="event-list">{commandEvents.slice(0, 12).map((event) => <article className="event-row" key={event.id}><div className="event-row-top"><span>{eventLabel(event.type)}</span><time>{relativeTime(event.occurred_at)}</time></div><p>{eventSummary(event)}</p></article>)}</div> : <div className="empty-block"><span><Send size={22} /></span><p>下发任务后，命令回执会出现在这里</p></div>}
        </section>
      </div>
    </div>
  )
}
