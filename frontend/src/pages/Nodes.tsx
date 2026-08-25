import { Bot, Network, Radio, Server } from 'lucide-react'
import { useControl } from '../lib/use-control'
import { deriveNodes, relativeTime } from '../lib/presentation'

export function Nodes() {
  const { bots, health, loading } = useControl()
  const nodes = deriveNodes(bots)

  return (
    <div className="page-stack">
      <section className="node-summary">
        <div><Server size={19} /><span>已连接代理</span><strong>{health?.connected_agents ?? 0}</strong></div>
        <div><Bot size={19} /><span>已注册机器人</span><strong>{bots.length}</strong></div>
      </section>
      {loading ? <NodeSkeleton /> : nodes.length ? <section className="node-grid">{nodes.map((node) => {
        const isConnected = node.id !== 'unassigned' && node.onlineCount > 0
        return <article className="node-panel" key={node.id}><div className="node-panel-head"><div><span className="panel-kicker"><Network size={15} /> 执行节点</span><h2>{node.id === 'unassigned' ? '未绑定代理' : node.id}</h2></div><span className={`node-state ${isConnected ? 'online' : 'offline'}`}>{isConnected ? '已连接' : '离线'}</span></div><dl className="node-stats"><div><dt>机器人</dt><dd>{node.botCount}</dd></div><div><dt>运行中</dt><dd>{node.runningCount}</dd></div><div><dt>在线</dt><dd>{node.onlineCount}</dd></div></dl><p className="node-update"><Radio size={14} /> {node.latestUpdate ? relativeTime(node.latestUpdate) : '尚未上报状态'}</p></article>
      })}</section> : <section className="surface-panel"><div className="empty-block"><span><Server size={22} /></span><p>代理连接后会按节点汇总显示在这里</p></div></section>}
    </div>
  )
}

function NodeSkeleton() {
  return <section className="node-grid">{Array.from({ length: 3 }, (_, index) => <div className="skeleton node-skeleton" key={index} />)}</section>
}
