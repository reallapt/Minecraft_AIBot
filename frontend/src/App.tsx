import { useMemo, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Sidebar } from './components/layout/Sidebar'
import { TopBar } from './components/layout/TopBar'
import { ControlProvider } from './lib/control'
import { useControl } from './lib/use-control'
import { AIDecisions } from './pages/AIDecisions'
import { Alerts } from './pages/Alerts'
import { Bots } from './pages/Bots'
import { Dashboard } from './pages/Dashboard'
import { Nodes } from './pages/Nodes'
import { Settings } from './pages/Settings'
import { Tasks } from './pages/Tasks'

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  '/': { title: '运行总览', subtitle: '机器人状态、节点连接和最新系统事件' },
  '/bots': { title: '机器人', subtitle: '查看状态并向已连接代理发送控制命令' },
  '/tasks': { title: '任务下发', subtitle: '将脚本任务直接发送到指定机器人' },
  '/ai': { title: 'AI 决策日志', subtitle: 'Qwen3 推理、工具调用和人工触发的审计记录' },
  '/nodes': { title: '执行节点', subtitle: '按代理节点汇总机器人连接状态' },
  '/alerts': { title: '异常关注', subtitle: '需要人工处理的机器人状态' },
  '/settings': { title: '连接设置', subtitle: '配置后端地址与访问令牌' },
}

function AppShell() {
  const location = useLocation()
  const { bots, connectionState, refresh, refreshing } = useControl()
  const [navigationOpen, setNavigationOpen] = useState(false)
  const page = pageTitles[location.pathname] || pageTitles['/']
  const attentionCount = useMemo(
    () => bots.filter((bot) => bot.status === 'error' || bot.status === 'stuck').length,
    [bots],
  )

  return (
    <div className="app-shell">
      <Sidebar
        open={navigationOpen}
        attentionCount={attentionCount}
        onClose={() => setNavigationOpen(false)}
      />
      <div className="app-main">
        <TopBar
          title={page.title}
          subtitle={page.subtitle}
          connectionState={connectionState}
          refreshing={refreshing}
          onMenu={() => setNavigationOpen(true)}
          onRefresh={() => void refresh()}
        />
        <main className="page-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/bots" element={<Bots />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/ai" element={<AIDecisions />} />
            <Route path="/nodes" element={<Nodes />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ControlProvider>
        <AppShell />
      </ControlProvider>
    </BrowserRouter>
  )
}
