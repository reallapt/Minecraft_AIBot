import { Menu, RefreshCw } from 'lucide-react'
import type { ConnectionState } from '../../types'

interface TopBarProps {
  title: string
  subtitle: string
  connectionState: ConnectionState
  refreshing: boolean
  onMenu: () => void
  onRefresh: () => void
}

const connectionLabel: Record<ConnectionState, string> = {
  connecting: '正在连接',
  connected: '实时已连接',
  disconnected: '正在重连',
  error: '连接异常',
}

export function TopBar({ title, subtitle, connectionState, refreshing, onMenu, onRefresh }: TopBarProps) {
  return (
    <header className="topbar">
      <button className="mobile-icon-button" aria-label="打开导航" onClick={onMenu}>
        <Menu size={19} strokeWidth={1.8} />
      </button>
      <div className="topbar-heading">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="topbar-spacer" />
      <div className={`connection-state ${connectionState}`} aria-live="polite">
        <span aria-hidden="true" />
        {connectionLabel[connectionState]}
      </div>
      <button className="icon-button" aria-label="刷新数据" title="刷新数据" onClick={onRefresh} disabled={refreshing}>
        <RefreshCw className={refreshing ? 'is-spinning' : ''} size={17} strokeWidth={1.8} />
      </button>
    </header>
  )
}
