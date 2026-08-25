import { AlertTriangle, Bot, ShieldCheck } from 'lucide-react'
import { useControl } from '../lib/use-control'
import { deriveAlerts, relativeTime } from '../lib/presentation'

export function Alerts() {
  const { bots, events, loading } = useControl()
  const alerts = deriveAlerts(bots, events)

  return (
    <div className="page-stack">
      <div className="inline-notice"><AlertTriangle size={17} /> 这里按当前机器人状态和任务失败事件生成。恢复状态后，机器人异常会自动消失。</div>
      <section className="surface-panel alerts-panel">
        {loading ? <AlertsSkeleton /> : alerts.length ? <div className="alert-list">{alerts.map((alert) => <article className={`alert-row ${alert.level}`} key={alert.id}><div className="alert-icon"><AlertTriangle size={18} /></div><div><div className="alert-row-heading"><strong>{alert.title}</strong><span>{alert.botId}</span></div><p>{alert.message}</p></div><time>{relativeTime(alert.occurredAt)}</time></article>)}</div> : <div className="empty-block"><span><ShieldCheck size={23} /></span><p>没有需要人工处理的机器人状态</p></div>}
      </section>
      {!alerts.length && !loading ? <section className="quiet-summary"><Bot size={17} /> 所有已注册机器人的最新状态正常</section> : null}
    </div>
  )
}

function AlertsSkeleton() {
  return <div className="alert-list">{Array.from({ length: 4 }, (_, index) => <div className="skeleton alert-skeleton" key={index} />)}</div>
}
