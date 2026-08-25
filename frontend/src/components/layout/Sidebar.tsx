import {
  Activity,
  AlertTriangle,
  Bot,
  LayoutDashboard,
  Network,
  Send,
  Settings,
  X,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'

interface SidebarProps {
  open: boolean
  attentionCount: number
  onClose: () => void
}

const navigation = [
  { to: '/', label: '运行总览', icon: LayoutDashboard, end: true },
  { to: '/bots', label: '机器人', icon: Bot },
  { to: '/tasks', label: '任务下发', icon: Send },
  { to: '/nodes', label: '执行节点', icon: Network },
  { to: '/ai', label: 'AI 决策', icon: Activity },
  { to: '/alerts', label: '异常关注', icon: AlertTriangle },
]

export function Sidebar({ open, attentionCount, onClose }: SidebarProps) {
  return (
    <>
      <button
        aria-label="关闭导航"
        className={`sidebar-backdrop ${open ? 'is-visible' : ''}`}
        onClick={onClose}
      />
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">MC</div>
          <div className="brand-copy">
            <strong>遥控假人</strong>
            <span>Control plane</span>
          </div>
          <button className="mobile-icon-button" aria-label="关闭导航" onClick={onClose}>
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>

        <nav className="primary-nav" aria-label="主导航">
          {navigation.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}
                onClick={onClose}
              >
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>{item.label}</span>
                {item.to === '/alerts' && attentionCount > 0 ? (
                  <span className="nav-count" aria-label={`${attentionCount} 个异常`}>{attentionCount}</span>
                ) : null}
              </NavLink>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`} onClick={onClose}>
            <Settings size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>连接设置</span>
          </NavLink>
          <p>实时控制台</p>
        </div>
      </aside>
    </>
  )
}
