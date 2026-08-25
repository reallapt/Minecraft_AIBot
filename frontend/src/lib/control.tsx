import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ApiError,
  connectDashboardSocket,
  fetchBots,
  fetchEvents,
  fetchHealth,
  getApiBase,
  getApiKey,
  sendCommand,
  setApiBase,
  setApiKey,
} from './api'
import type { BotRecord, BotView, CommandRequest, ConnectionState, EventEnvelope, HealthResponse } from '../types'
import { ControlContext, type ControlContextValue } from './control-context'

export function ControlProvider({ children }: { children: React.ReactNode }) {
  const [bots, setBots] = useState<BotView[]>([])
  const [events, setEvents] = useState<EventEnvelope[]>([])
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [apiBase, setCurrentApiBase] = useState(() => getApiBase())
  const [apiKey, setCurrentApiKey] = useState(() => getApiKey())
  const [connectionVersion, setConnectionVersion] = useState(0)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    const [botsResult, eventsResult, healthResult] = await Promise.allSettled([
      fetchBots(),
      fetchEvents(),
      fetchHealth(),
    ])

    if (botsResult.status === 'fulfilled') {
      setBots(botsResult.value.map(toBotView))
      setError(null)
    } else {
      setError(toMessage(botsResult.reason))
      setConnectionState('error')
    }
    if (eventsResult.status === 'fulfilled') {
      setEvents(sortEvents(eventsResult.value))
    }
    if (healthResult.status === 'fulfilled') {
      setHealth(healthResult.value)
    }

    setLoading(false)
    setRefreshing(false)
  }, [])

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await fetchHealth())
    } catch {
      // A later refresh or dashboard snapshot will restore the aggregate count.
    }
  }, [])

  const applyEvent = useCallback((event: EventEnvelope) => {
    setEvents((current) => sortEvents([event, ...current.filter((item) => item.id !== event.id)]).slice(0, 150))

    if (event.type === 'bot.registered' || event.type === 'bot.updated') {
      const record = event.payload as unknown as BotRecord
      if (isBotRecord(record)) {
        const nextBot = toBotView(record)
        setBots((current) => sortBots([nextBot, ...current.filter((bot) => bot.bot_id !== nextBot.bot_id)]))
      }
    }

    if (event.type === 'agent.registered' || event.type === 'agent.disconnected' || event.type === 'bot.registered') {
      void refreshHealth()
    }
  }, [refreshHealth])

  useEffect(() => {
    // The initial REST sync belongs to the provider lifecycle and resolves asynchronously.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
    const socket = connectDashboardSocket({
      onOpen: () => {
        setConnectionState('connected')
        setError(null)
      },
      onClose: () => setConnectionState('disconnected'),
      onError: () => setConnectionState('error'),
      onSnapshot: (snapshot) => {
        setBots(snapshot.bots.map(toBotView))
        setHealth((current) => current ? { ...current, connected_agents: snapshot.connectedAgents, known_bots: snapshot.bots.length } : {
          status: 'ok',
          connected_agents: snapshot.connectedAgents,
          known_bots: snapshot.bots.length,
        })
      },
      onEvent: applyEvent,
    })
    return () => socket.close()
  }, [applyEvent, connectionVersion, refresh])

  const issueCommand = useCallback(async (botId: string, command: CommandRequest) => {
    const envelope = await sendCommand(botId, command)
    await refresh()
    return envelope
  }, [refresh])

  const saveConnection = useCallback((nextApiBase: string, nextApiKey: string) => {
    setApiBase(nextApiBase)
    setApiKey(nextApiKey)
    setCurrentApiBase(getApiBase())
    setCurrentApiKey(getApiKey())
    setConnectionVersion((current) => current + 1)
  }, [])

  const value = useMemo<ControlContextValue>(() => ({
    bots,
    events,
    health,
    loading,
    refreshing,
    connectionState,
    error,
    apiBase,
    apiKey,
    refresh,
    issueCommand,
    saveConnection,
  }), [apiBase, apiKey, bots, connectionState, error, events, health, issueCommand, loading, refresh, refreshing, saveConnection])

  return <ControlContext.Provider value={value}>{children}</ControlContext.Provider>
}

function toBotView(record: BotRecord): BotView {
  return {
    ...record,
    displayName: record.display_name || record.bot_id,
    agentName: record.agent_id || '未连接节点',
  }
}

function isBotRecord(value: unknown): value is BotRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.bot_id === 'string' && typeof record.status === 'string'
}

function sortBots(values: BotView[]): BotView[] {
  return [...values].sort((first, second) => first.displayName.localeCompare(second.displayName, 'zh-CN'))
}

function sortEvents(values: EventEnvelope[]): EventEnvelope[] {
  return [...values].sort((first, second) => second.occurred_at.localeCompare(first.occurred_at))
}

function toMessage(reason: unknown): string {
  if (reason instanceof ApiError) return `后端响应 ${reason.status}: ${reason.message}`
  if (reason instanceof Error) return reason.message
  return '无法连接后端服务'
}
