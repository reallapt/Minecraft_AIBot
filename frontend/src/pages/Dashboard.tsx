import { Activity, AlertTriangle, Bot, Wifi } from 'lucide-react'
import { Link } from 'react-router-dom'
import { BotStatusBadge } from '../components/common/StatusBadge'
import { useControl } from '../lib/use-control'
import { deriveAlerts, eventLabel, eventSummary, relativeTime } from '../lib/presentation'

function Metric({ label, value, detail, tone }: { label: string; value: number; detail: string; tone: string }) {
  return (
    <section className={`metric ${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </section>
  )
}

export function Dashboard() {
  const { bots, events, health, loading, error, connectionState } = useControl()
  const running = bots.filter((bot) => bot.status === 'running').length
  const idle = bots.filter((bot) => bot.status === 'idle').length
  const attention = deriveAlerts(bots, events)
  const activeBots = bots.filter((bot) => bot.status !== 'offline').slice(0, 6)

  if (loading) return <DashboardSkeleton />

  return (
    <div className="page-stack">
      {error ? <div className="inline-notice error"><AlertTriangle size={17} /> {error}</div> : null}
      <div className="metrics-grid">
        <Metric label="已知机器人" value={health?.known_bots ?? bots.length} detail={`${idle} 个空闲`} tone="neutral" />
        <Metric label="正在运行" value={running} detail="由代理实时上报" tone="accent" />
        <Metric label="已连接节点" value={health?.connected_agents ?? 0} detail={connectionState === 'connected' ? 'WebSocket 已连接' : '正在同步状态'} tone="success" />
        <Metric label="需要关注" value={attention.length} detail={attention.length ? '请检查错误或卡住状态' : '当前没有异常状态'} tone={attention.length ? 'warning' : 'neutral'} />
      </div>

      <div className="dashboard-grid">
        <section className="surface-panel bot-overview-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker"><Bot size={15} /> 机器人</span>
              <h2>当前状态</h2>
            </div>
            <Link className="text-link" to="/bots">查看全部</Link>
          </div>
          {activeBots.length === 0 ? (
            <EmptyBlock icon={<Bot size={22} />} text="等待执行代理注册机器人" />
          ) : (
            <div className="status-list">
              {activeBots.map((bot) => (
                <Link className="status-row" key={bot.bot_id} to={`/bots?selected=${encodeURIComponent(bot.bot_id)}`}>
                  <div>
                    <strong>{bot.displayName}</strong>
                    <span>{bot.agentName}</span>
                  </div>
                  <div className="status-row-meta">
                    <BotStatusBadge status={bot.status} />
                    <span>{bot.current_task_id || '无任务'}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="surface-panel event-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker"><Activity size={15} /> 系统事件</span>
              <h2>最近动态</h2>
            </div>
            <Link className="text-link" to="/ai">打开事件流</Link>
          </div>
          {events.length === 0 ? (
            <EmptyBlock icon={<Activity size={22} />} text="代理上线或命令下发后，事件会显示在这里" />
          ) : (
            <div className="event-list compact">
              {events.slice(0, 6).map((event) => (
                <article className="event-row" key={event.id}>
                  <div className="event-row-top"><span>{eventLabel(event.type)}</span><time>{relativeTime(event.occurred_at)}</time></div>
                  <p>{eventSummary(event)}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="surface-panel attention-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker"><AlertTriangle size={15} /> 异常关注</span>
            <h2>需要检查的状态</h2>
          </div>
          <Link className="text-link" to="/alerts">打开异常关注</Link>
        </div>
        {attention.length === 0 ? (
          <EmptyBlock icon={<Wifi size={22} />} text="所有已连接机器人都处于可执行状态" />
        ) : (
          <div className="attention-list">
            {attention.slice(0, 4).map((alert) => (
              <Link className={`attention-row ${alert.level}`} key={alert.id} to={`/bots?selected=${encodeURIComponent(alert.botId)}`}>
                <AlertTriangle size={17} />
                <div><strong>{alert.title}</strong><span>{alert.message}</span></div>
                <time>{relativeTime(alert.occurredAt)}</time>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function EmptyBlock({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <div className="empty-block"><span>{icon}</span><p>{text}</p></div>
}

function DashboardSkeleton() {
  return (
    <div className="page-stack" aria-label="正在加载控制台">
      <div className="metrics-grid">{Array.from({ length: 4 }, (_, index) => <div className="skeleton metric-skeleton" key={index} />)}</div>
      <div className="dashboard-grid"><div className="skeleton panel-skeleton" /><div className="skeleton panel-skeleton" /></div>
    </div>
  )
}
