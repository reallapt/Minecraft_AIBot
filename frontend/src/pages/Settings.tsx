import { Bot, CheckCircle2, KeyRound, Link2, RotateCw, Save, Server } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { fetchAiConfig, testAiRuntime, testBackendConnection } from '../lib/api'
import { useControl } from '../lib/use-control'
import type { AIConfig } from '../types'

export function Settings() {
  const { apiBase, apiKey, health, connectionState, error, saveConnection } = useControl()
  const [draftBase, setDraftBase] = useState(apiBase)
  const [draftKey, setDraftKey] = useState(apiKey)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null)
  const [aiLoading, setAiLoading] = useState(true)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiTesting, setAiTesting] = useState(false)
  const [aiTestResult, setAiTestResult] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  const loadAiConfig = useCallback(async () => {
    setAiLoading(true)
    setAiError(null)
    try {
      setAiConfig(await fetchAiConfig())
    } catch (loadError) {
      setAiError(messageFor(loadError, '无法读取 AI 运行配置'))
    } finally {
      setAiLoading(false)
    }
  }, [])

  useEffect(() => {
    // Runtime configuration is owned by the backend and loaded on route entry.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadAiConfig()
  }, [loadAiConfig])

  const save = () => {
    saveConnection(draftBase, draftKey)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2500)
    void loadAiConfig()
  }

  const testAiConnection = async () => {
    setAiTesting(true)
    setAiTestResult(null)
    try {
      const result = await testAiRuntime(draftBase, draftKey)
      setAiTestResult({ tone: 'success', message: `AI 运行时正常响应（${result.status}）` })
      void loadAiConfig()
    } catch (testError) {
      setAiTestResult({ tone: 'error', message: messageFor(testError, '无法连接 AI 运行时') })
    } finally {
      setAiTesting(false)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testBackendConnection(draftBase, draftKey)
      setTestResult({ tone: 'success', message: `后端 API 正常响应（${result.status}）` })
    } catch (testError) {
      setTestResult({
        tone: 'error',
        message: testError instanceof Error ? testError.message : '无法连接后端服务',
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="page-stack settings-layout">
      <section className="surface-panel settings-panel">
        <div className="panel-heading"><div><span className="panel-kicker"><Link2 size={15} /> 后端连接</span><h2>服务地址与访问令牌</h2></div></div>
        <div className="settings-form">
          <label className="field-label">API 地址<input value={draftBase} onChange={(event) => setDraftBase(event.target.value)} placeholder="/api/v1 或 http://127.0.0.1:8000/api/v1" /></label>
          <label className="field-label">API 令牌<input type="password" value={draftKey} onChange={(event) => setDraftKey(event.target.value)} placeholder="未启用鉴权时可留空" autoComplete="off" /></label>
          <p className="field-hint">令牌仅保存在当前浏览器的本地存储中，并随 REST 和 WebSocket 请求发送。</p>
          <div className="settings-actions"><button className="command-button" onClick={() => void testConnection()} disabled={testing}><RotateCw size={15} />{testing ? '测试中' : '测试连接'}</button><button className="command-button primary" onClick={save}><Save size={15} /> 保存连接</button></div>
          {testResult ? <p className={`form-message ${testResult.tone}`}>{testResult.tone === 'success' ? <CheckCircle2 size={16} /> : null}{testResult.message}</p> : null}
          {saved ? <p className="form-message success"><CheckCircle2 size={16} /> 连接设置已保存</p> : null}
        </div>
      </section>
      <section className="surface-panel connection-panel">
        <div className="panel-heading"><div><span className="panel-kicker"><Server size={15} /> 当前状态</span><h2>后端可用性</h2></div></div>
        <dl className="connection-facts"><div><dt>实时通道</dt><dd className={connectionState}>{connectionState === 'connected' ? '已连接' : connectionState === 'connecting' ? '正在连接' : connectionState === 'disconnected' ? '正在重连' : '连接异常'}</dd></div><div><dt>已连接代理</dt><dd>{health?.connected_agents ?? '未获取'}</dd></div><div><dt>已知机器人</dt><dd>{health?.known_bots ?? '未获取'}</dd></div><div><dt>API 鉴权</dt><dd>{draftKey ? <><KeyRound size={14} /> 已配置</> : '未配置'}</dd></div></dl>
        {error ? <p className="form-message error">{error}</p> : null}
      </section>
      <section className="surface-panel ai-runtime-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker"><Bot size={15} /> AI 运行时</span>
            <h2>Ollama 与 Qwen3</h2>
          </div>
          <button className="icon-button" type="button" aria-label="刷新 AI 配置" title="刷新 AI 配置" onClick={() => void loadAiConfig()} disabled={aiLoading}>
            <RotateCw className={aiLoading ? 'is-spinning' : ''} size={16} />
          </button>
        </div>
        {aiLoading ? <div className="runtime-skeletons"><div className="skeleton runtime-skeleton" /><div className="skeleton runtime-skeleton" /><div className="skeleton runtime-skeleton" /></div> : aiConfig ? (
          <dl className="connection-facts ai-runtime-facts">
            <div><dt>调度状态</dt><dd className={aiConfig.enabled ? 'connected' : 'disconnected'}>{aiConfig.enabled ? '已启用' : '已停用'}</dd></div>
            <div><dt>模型</dt><dd className="mono-value" title={aiConfig.model || undefined}>{aiConfig.model || '未配置'}</dd></div>
            <div><dt>Ollama 地址</dt><dd className="mono-value" title={runtimeUrlLabel(aiConfig.base_url)}>{runtimeUrlLabel(aiConfig.base_url)}</dd></div>
            <div><dt>请求超时</dt><dd>{aiConfig.timeout_seconds} 秒</dd></div>
            <div><dt>最大工具轮次</dt><dd>{aiConfig.max_tool_rounds}</dd></div>
          </dl>
        ) : null}
        {aiError ? <p className="form-message error runtime-message">{aiError}</p> : null}
        <div className="runtime-actions">
          <button className="command-button" type="button" onClick={() => void testAiConnection()} disabled={aiTesting}>
            <RotateCw className={aiTesting ? 'is-spinning' : ''} size={15} />
            {aiTesting ? '测试中' : '测试 AI 运行时'}
          </button>
        </div>
        {aiTestResult ? <p className={`form-message runtime-message ${aiTestResult.tone}`}>{aiTestResult.tone === 'success' ? <CheckCircle2 size={16} /> : null}{aiTestResult.message}</p> : null}
      </section>
    </div>
  )
}

function runtimeUrlLabel(value: string | null): string {
  if (!value) return '未配置'
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return '已配置'
  }
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
