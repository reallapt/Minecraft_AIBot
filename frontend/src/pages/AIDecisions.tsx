import { Activity, ChevronDown, Filter, Play, RefreshCw, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { createAiDecision, fetchAiDecisions } from '../lib/api'
import { useControl } from '../lib/use-control'
import { eventLabel, eventSummary, relativeTime } from '../lib/presentation'
import type { AIDecision, AIToolCall, EventEnvelope } from '../types'

export function AIDecisions() {
  const { events, loading: systemLoading } = useControl()
  const [decisions, setDecisions] = useState<AIDecision[]>([])
  const [loading, setLoading] = useState(true)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [allowCommands, setAllowCommands] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')

  const refreshDecisions = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setDecisionError(null)
    try {
      setDecisions(sortDecisions(await fetchAiDecisions()))
    } catch (error) {
      setDecisionError(errorMessage(error, '无法读取 AI 决策日志'))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    // The decision log is loaded once when this route becomes active.
    // oxlint-disable-next-line react/set-state-in-effect
    void refreshDecisions()
  }, [refreshDecisions])

  const statuses = useMemo(
    () => [...new Set(decisions.map((decision) => decision.status).filter(Boolean))],
    [decisions],
  )
  const visibleDecisions = statusFilter === 'all'
    ? decisions
    : decisions.filter((decision) => decision.status === statusFilter)

  const submitDecision = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt) {
      setSubmitError('请输入决策请求')
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    setSuccessMessage(null)
    try {
      const decision = await createAiDecision({
        prompt: normalizedPrompt,
        allow_commands: allowCommands,
      })
      setDecisions((current) => sortDecisions([
        decision,
        ...current.filter((item) => item.id !== decision.id),
      ]))
      setPrompt('')
      setStatusFilter('all')
      void refreshDecisions(true)
      const done = decision.status === 'completed' || decision.status === 'succeeded' || decision.status === 'success'
      setSuccessMessage(done
        ? `✅ AI 决策已完成：${decision.summary ? decision.summary.slice(0, 80) + (decision.summary.length > 80 ? '…' : '') : '见下方决策日志'}`
        : `⚠️ AI 决策返回状态：${decision.status}`)
      window.setTimeout(() => setSuccessMessage(null), 8000)
    } catch (error) {
      setSubmitError(errorMessage(error, '无法创建 AI 决策'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-stack">
      <section className="surface-panel ai-command-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker"><Activity size={15} /> 人工触发</span>
            <h2>发起 AI 决策</h2>
          </div>
        </div>
        <form className="ai-command-form" onSubmit={(event) => void submitDecision(event)}>
          <label className="field-label">
            决策请求
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="例如：检查所有空闲机器人，并安排可执行的任务"
              disabled={submitting}
            />
          </label>
          <label className="check-option">
            <input
              type="checkbox"
              checked={allowCommands}
              onChange={(event) => setAllowCommands(event.target.checked)}
              disabled={submitting}
            />
            <span>允许下发控制命令</span>
          </label>
          <div className="settings-actions">
            <button className="command-button primary" type="submit" disabled={submitting}>
              <Play size={15} />
              {submitting ? 'AI 思考中…' : '请求 AI 决策'}
            </button>
          </div>
          {submitting ? (
            <p className="form-message info">⏳ qwen3 正在推理，通常需要 20~60 秒（含工具调用），请耐心等待，不要重复提交…</p>
          ) : null}
          {submitError ? <p className="form-message error">{submitError}</p> : null}
          {successMessage ? <p className="form-message success">{successMessage}</p> : null}
        </form>
      </section>

      {decisionError ? <div className="inline-notice error">{decisionError}</div> : null}

      <section className="toolbar-row ai-toolbar">
        <label className="filter-select">
          <Filter size={16} aria-hidden="true" />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">全部状态</option>
            {statuses.map((status) => <option key={status} value={status}>{decisionStatusLabel(status)}</option>)}
          </select>
        </label>
        <span className="toolbar-count">{visibleDecisions.length} 条决策</span>
        <button
          className="icon-button"
          type="button"
          aria-label="刷新 AI 决策日志"
          title="刷新 AI 决策日志"
          onClick={() => void refreshDecisions()}
          disabled={loading}
        >
          <RefreshCw className={loading ? 'is-spinning' : ''} size={16} />
        </button>
      </section>

      <section className="surface-panel ai-decision-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker"><Activity size={15} /> AI 决策日志</span>
            <h2>模型响应与工具调用</h2>
          </div>
        </div>
        {loading ? <DecisionSkeleton /> : visibleDecisions.length ? (
          <div className="decision-list">
            {visibleDecisions.map((decision) => <DecisionRow decision={decision} key={decision.id} />)}
          </div>
        ) : (
          <div className="empty-block">
            <span><Activity size={22} /></span>
            <p>{statusFilter === 'all' ? '暂无 AI 决策记录' : '没有匹配状态的 AI 决策'}</p>
          </div>
        )}
      </section>

      {events.length || systemLoading ? <SystemEventFallback events={events} loading={systemLoading} /> : null}
    </div>
  )
}

function DecisionRow({ decision }: { decision: AIDecision }) {
  const timestamp = decisionTimestamp(decision)
  const toolCalls = decision.tool_calls || []
  const messages = decision.messages || []

  return (
    <article className={`decision-row ${decisionStatusTone(decision.status)}`}>
      <header className="decision-row-header">
        <div className="decision-row-main">
          <div className="decision-row-meta">
            <span className={`decision-status ${decisionStatusTone(decision.status)}`}>{decisionStatusLabel(decision.status)}</span>
            {decision.model ? <span className="decision-model" title={decision.model}>{decision.model}</span> : null}
          </div>
          <p className="decision-prompt">{decision.prompt || '未提供决策请求'}</p>
          {decision.summary ? <p className="decision-summary">{decision.summary}</p> : null}
        </div>
        <time title={timestamp || undefined}>{formatDecisionTime(timestamp)}</time>
      </header>

      {decision.error ? <p className="decision-error">{decision.error}</p> : null}

      {toolCalls.length ? <ToolCalls toolCalls={toolCalls} /> : null}
      {messages.length ? (
        <details className="decision-details">
          <summary>原始消息 ({messages.length})<ChevronDown size={15} /></summary>
          <pre>{formatStructured(messages)}</pre>
        </details>
      ) : null}
    </article>
  )
}

function ToolCalls({ toolCalls }: { toolCalls: AIToolCall[] }) {
  return (
    <details className="decision-details tool-call-details">
      <summary><span><Wrench size={15} /> 工具调用 ({toolCalls.length})</span><ChevronDown size={15} /></summary>
      <div className="tool-call-list">
        {toolCalls.map((toolCall, index) => (
          <article className="tool-call" key={toolCall.id || `${toolCall.name}-${index}`}>
            <div className="tool-call-heading">
              <strong>{toolCall.name || '未命名工具'}</strong>
              {toolCall.error ? <span className="tool-call-error">调用失败</span> : <span className="tool-call-success">已返回</span>}
            </div>
            <div className="tool-call-payloads">
              <div><span>参数</span><pre>{formatStructured(toolCall.arguments)}</pre></div>
              <div><span>{toolCall.error ? '错误' : '结果'}</span><pre>{toolCall.error || formatStructured(toolCall.result)}</pre></div>
            </div>
          </article>
        ))}
      </div>
    </details>
  )
}

function SystemEventFallback({ events, loading }: { events: EventEnvelope[]; loading: boolean }) {
  return (
    <section className="surface-panel event-stream-panel system-event-panel">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker"><Activity size={15} /> 系统事件回退</span>
          <h2>代理与命令事件</h2>
        </div>
      </div>
      {loading ? <StreamSkeleton /> : events.length ? (
        <div className="event-list stream">
          {events.map((event) => (
            <details className="event-detail" key={event.id}>
              <summary>
                <div><span>{eventLabel(event.type)}</span><p>{eventSummary(event)}</p></div>
                <time>{relativeTime(event.occurred_at)}</time>
                <ChevronDown size={16} />
              </summary>
              <pre>{formatStructured(event.payload)}</pre>
            </details>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function DecisionSkeleton() {
  return <div className="decision-list">{Array.from({ length: 4 }, (_, index) => <div className="skeleton decision-skeleton" key={index} />)}</div>
}

function StreamSkeleton() {
  return <div className="event-list">{Array.from({ length: 4 }, (_, index) => <div className="skeleton event-skeleton" key={index} />)}</div>
}

function decisionTimestamp(decision: AIDecision): string | null {
  return decision.finished_at || decision.completed_at || decision.started_at || decision.created_at || null
}

function formatDecisionTime(timestamp: string | null): string {
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) return '时间未知'
  return relativeTime(timestamp)
}

function decisionStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: '排队中',
    pending: '等待中',
    running: '执行中',
    completed: '已完成',
    succeeded: '已完成',
    success: '已完成',
    failed: '失败',
    error: '失败',
    cancelled: '已取消',
  }
  return labels[status.toLowerCase()] || status || '未知'
}

function decisionStatusTone(status: string): 'working' | 'success' | 'error' | 'neutral' {
  const normalized = status.toLowerCase()
  if (normalized === 'completed' || normalized === 'succeeded' || normalized === 'success') return 'success'
  if (normalized === 'failed' || normalized === 'error' || normalized === 'cancelled') return 'error'
  if (normalized === 'queued' || normalized === 'pending' || normalized === 'running') return 'working'
  return 'neutral'
}

function sortDecisions(decisions: AIDecision[]): AIDecision[] {
  return [...decisions].sort((first, second) => (decisionTimestamp(second) || '').localeCompare(decisionTimestamp(first) || ''))
}

function formatStructured(value: unknown): string {
  if (value === undefined || value === null) return '无'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
