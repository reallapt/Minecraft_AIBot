import { createContext } from 'react'
import type {
  BotView,
  CommandEnvelope,
  CommandRequest,
  ConnectionState,
  EventEnvelope,
  HealthResponse,
} from '../types'

export interface ControlContextValue {
  bots: BotView[]
  events: EventEnvelope[]
  health: HealthResponse | null
  loading: boolean
  refreshing: boolean
  connectionState: ConnectionState
  error: string | null
  apiBase: string
  apiKey: string
  refresh: () => Promise<void>
  issueCommand: (botId: string, command: CommandRequest) => Promise<CommandEnvelope>
  saveConnection: (apiBase: string, apiKey: string) => void
}

export const ControlContext = createContext<ControlContextValue | null>(null)
