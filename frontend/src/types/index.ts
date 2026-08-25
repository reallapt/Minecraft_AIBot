export type BotStatus = 'idle' | 'running' | 'paused' | 'error' | 'stuck' | 'offline'

export type CommandType = 'run_task' | 'pause' | 'resume' | 'stop' | 'screenshot' | 'inventory'

export interface BotRecord {
  bot_id: string
  display_name: string | null
  game_server: string | null
  status: BotStatus
  metadata: Record<string, unknown>
  agent_id: string | null
  current_task_id: string | null
  current_step: number | null
  hp: number | null
  position: string | null
  error: string | null
  updated_at: string
}

export interface BotView extends BotRecord {
  displayName: string
  agentName: string
}

export interface CommandRequest {
  type: CommandType
  task?: string
  params?: Record<string, unknown>
}

export interface CommandEnvelope {
  id: string
  type: CommandType
  bot_id: string
  task: string | null
  params: Record<string, unknown>
  issued_at: string
}

export interface EventEnvelope {
  id: string
  type: string
  occurred_at: string
  payload: Record<string, unknown>
}

export interface HealthResponse {
  status: 'ok'
  connected_agents: number
  known_bots: number
}

export interface AIConfig {
  enabled: boolean
  base_url: string | null
  model: string | null
  timeout_seconds: number
  max_tool_rounds: number
}

export interface AIHealthResponse {
  status: string
  enabled?: boolean
  model?: string | null
  base_url?: string | null
  detail?: string | null
  error?: string | null
}

export interface AIToolCall {
  id: string
  name: string
  arguments?: unknown
  result?: unknown
  error?: string | null
}

export interface AIDecision {
  id: string
  status: string
  prompt: string
  summary?: string | null
  model?: string | null
  started_at?: string | null
  finished_at?: string | null
  created_at?: string | null
  completed_at?: string | null
  error?: string | null
  tool_calls?: AIToolCall[]
  messages?: unknown[] | null
}

export interface AIDecisionRequest {
  prompt: string
  allow_commands?: boolean
}

export interface DashboardSnapshot {
  bots: BotRecord[]
  connected_agents: number
}

export interface ManualBotCreate {
  bot_id: string
  display_name?: string
  game_server?: string
  metadata?: Record<string, unknown>
}

export interface InventoryItem {
  slot: number
  name: string
  display_name?: string | null
  count: number
}

export interface BotInventory {
  bot_id: string
  items: InventoryItem[]
  armor: InventoryItem[]
  offhand?: InventoryItem | null
  held_item?: InventoryItem | null
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface NodeSummary {
  id: string
  botCount: number
  runningCount: number
  onlineCount: number
  latestUpdate: string | null
}

export type AlertLevel = 'warning' | 'error'

export interface DerivedAlert {
  id: string
  level: AlertLevel
  title: string
  message: string
  botId: string
  occurredAt: string
}
