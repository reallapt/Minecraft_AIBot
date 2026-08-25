import type {
  AIConfig,
  AIDecision,
  AIDecisionRequest,
  AIHealthResponse,
  BotInventory,
  BotRecord,
  CommandEnvelope,
  CommandRequest,
  EventEnvelope,
  HealthResponse,
  ManualBotCreate,
} from '../types'

const API_BASE_STORAGE_KEY = 'mc_api_base'
const API_KEY_STORAGE_KEY = 'mc_api_key'
const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE?.trim() || '/api/v1'

export class ApiError extends Error {
  readonly status: number

  constructor(
    message: string,
    status: number,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function normalizeApiBase(value: string): string {
  const base = value.trim().replace(/\/+$/, '')
  if (!base) return '/api/v1'
  if (base.endsWith('/api/v1')) return base
  if (base.endsWith('/api')) return `${base}/v1`
  return `${base}/api/v1`
}

export function getApiBase(): string {
  return normalizeApiBase(localStorage.getItem(API_BASE_STORAGE_KEY) || DEFAULT_API_BASE)
}

function hasStoredApiBase(): boolean {
  return localStorage.getItem(API_BASE_STORAGE_KEY) !== null
}

export function setApiBase(value: string): void {
  localStorage.setItem(API_BASE_STORAGE_KEY, normalizeApiBase(value))
}

export function getApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE_KEY) || import.meta.env.VITE_API_KEY || ''
}

export function setApiKey(value: string): void {
  const key = value.trim()
  if (key) {
    localStorage.setItem(API_KEY_STORAGE_KEY, key)
    return
  }
  localStorage.removeItem(API_KEY_STORAGE_KEY)
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return requestFromBase<T>(getApiBase(), getApiKey(), path, options)
}

async function requestFromBase<T>(apiBase: string, apiKey: string, path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (apiKey.trim()) {
    headers.set('X-API-Key', apiKey.trim())
  }

  const response = await fetch(`${normalizeApiBase(apiBase)}${path}`, { ...options, headers })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new ApiError(detail || response.statusText, response.status)
  }
  // 204/空响应体（如 DELETE）不解析 JSON
  if (response.status === 204) return undefined as T
  const text = await response.text().catch(() => '')
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

export function fetchBots(): Promise<BotRecord[]> {
  return request<BotRecord[]>('/bots')
}

export function fetchEvents(limit = 100): Promise<EventEnvelope[]> {
  return request<EventEnvelope[]>(`/events?limit=${limit}`)
}

export function fetchAiConfig(): Promise<AIConfig> {
  return request<AIConfig>('/ai/config')
}

export function fetchAiDecisions(limit = 100): Promise<AIDecision[]> {
  return request<AIDecision[]>(`/ai/decisions?limit=${limit}`)
}

export function createAiDecision(data: AIDecisionRequest): Promise<AIDecision> {
  return request<AIDecision>('/ai/decisions', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function testAiRuntime(apiBase = getApiBase(), apiKey = getApiKey()): Promise<AIHealthResponse> {
  return requestFromBase<AIHealthResponse>(apiBase, apiKey, '/ai/health', { method: 'POST' })
}

export function createBot(data: ManualBotCreate): Promise<BotRecord> {
  return request<BotRecord>('/bots', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function deleteBot(botId: string): Promise<void> {
  return request<void>(`/bots/${encodeURIComponent(botId)}`, {
    method: 'DELETE',
  })
}

export function sendCommand(botId: string, command: CommandRequest): Promise<CommandEnvelope> {
  return request<CommandEnvelope>(`/bots/${encodeURIComponent(botId)}/commands`, {
    method: 'POST',
    body: JSON.stringify(command),
  })
}

export function fetchBotInventory(botId: string): Promise<BotInventory> {
  return request<BotInventory>(`/bots/${encodeURIComponent(botId)}/inventory`)
}

export async function fetchHealth(apiBase = getApiBase(), apiKey = getApiKey()): Promise<HealthResponse> {
  const normalizedApiBase = normalizeApiBase(apiBase)
  const healthBase = normalizedApiBase.replace(/\/api\/v1$/, '')
  const headers = apiKey.trim() ? { 'X-API-Key': apiKey.trim() } : undefined
  const response = await fetch(`${healthBase}/health`, { headers })
  if (!response.ok) {
    throw new ApiError(response.statusText, response.status)
  }
  return response.json() as Promise<HealthResponse>
}

export async function testBackendConnection(apiBase: string, apiKey: string): Promise<HealthResponse> {
  const normalizedApiBase = normalizeApiBase(apiBase)
  const headers = apiKey.trim() ? { 'X-API-Key': apiKey.trim() } : undefined
  const [health, botsResponse] = await Promise.all([
    fetchHealth(normalizedApiBase, apiKey),
    fetch(`${normalizedApiBase}/bots`, { headers }),
  ])

  if (!botsResponse.ok) {
    const detail = await botsResponse.text().catch(() => '')
    throw new ApiError(detail || botsResponse.statusText, botsResponse.status)
  }

  return health
}

function websocketUrl(): string {
  const apiBase = getApiBase()
  if (hasStoredApiBase() && /^https?:\/\//.test(apiBase)) {
    const url = new URL(apiBase)
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${url.host}/ws/dashboard`
  }

  const configured = import.meta.env.VITE_WS_BASE?.trim().replace(/\/+$/, '')
  if (configured) {
    if (/^wss?:\/\//.test(configured)) {
      return configured.endsWith('/ws')
        ? `${configured}/dashboard`
        : `${configured}/ws/dashboard`
    }

    const path = configured.startsWith('/') ? configured : `/${configured}`
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}${path.endsWith('/ws') ? `${path}/dashboard` : `${path}/ws/dashboard`}`
  }

  if (/^https?:\/\//.test(apiBase)) {
    const url = new URL(apiBase)
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${url.host}/ws/dashboard`
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/dashboard`
}

interface DashboardSocketHandlers {
  onOpen: () => void
  onClose: () => void
  onError: () => void
  onSnapshot: (snapshot: { bots: BotRecord[]; connectedAgents: number }) => void
  onEvent: (event: EventEnvelope) => void
}

export function connectDashboardSocket(handlers: DashboardSocketHandlers): { close: () => void } {
  let socket: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof window.setTimeout> | null = null
  let pingTimer: ReturnType<typeof window.setInterval> | null = null
  let closedByClient = false
  let retryDelay = 1000

  const cleanTimers = () => {
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
    if (pingTimer !== null) window.clearInterval(pingTimer)
    reconnectTimer = null
    pingTimer = null
  }

  const connect = () => {
    cleanTimers()
    socket = new WebSocket(`${websocketUrl()}${getApiKey() ? `?token=${encodeURIComponent(getApiKey())}` : ''}`)

    socket.onopen = () => {
      retryDelay = 1000
      handlers.onOpen()
      pingTimer = window.setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }))
        }
      }, 30000)
    }

    socket.onmessage = (message) => {
      try {
        const data: unknown = JSON.parse(message.data as string)
        if (!data || typeof data !== 'object') return
        const payload = data as Record<string, unknown>
        if (payload.type === 'dashboard.snapshot' && isDashboardSnapshot(payload.payload)) {
          handlers.onSnapshot({
            bots: payload.payload.bots,
            connectedAgents: payload.payload.connected_agents,
          })
          return
        }
        if (typeof payload.id === 'string' && typeof payload.type === 'string' && typeof payload.occurred_at === 'string') {
          handlers.onEvent(payload as unknown as EventEnvelope)
        }
      } catch {
        handlers.onError()
      }
    }

    socket.onerror = () => handlers.onError()
    socket.onclose = () => {
      if (pingTimer !== null) window.clearInterval(pingTimer)
      pingTimer = null
      handlers.onClose()
      if (!closedByClient) {
        reconnectTimer = window.setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 10000)
      }
    }
  }

  connect()
  return {
    close: () => {
      closedByClient = true
      cleanTimers()
      socket?.close()
    },
  }
}

function isDashboardSnapshot(value: unknown): value is { bots: BotRecord[]; connected_agents: number } {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Record<string, unknown>
  return Array.isArray(snapshot.bots) && typeof snapshot.connected_agents === 'number'
}
