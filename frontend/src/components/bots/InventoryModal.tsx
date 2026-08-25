import { Loader2, Package, RefreshCw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react'
import { fetchBotInventory, sendCommand } from '../../lib/api'
import type { BotInventory, InventoryItem } from '../../types'

interface InventoryModalProps {
  botId: string
  botName: string
  onClose: () => void
  onToast: (message: string, kind?: 'success' | 'error') => void
}

/** 物品图标路径（未知物品用兜底图） */
function itemIcon(name: string): string {
  return `/items/${name}.png`
}

function ItemImage({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <img
      src={itemIcon(name)}
      alt={name}
      width={size}
      height={size}
      draggable={false}
      onError={(event) => { event.currentTarget.src = '/items/_unknown.png' }}
    />
  )
}

/** 背包格子（可拖拽/放置/点击选中） */
function SlotCell({
  slot,
  item,
  label,
  isArmor = false,
  selected,
  busy,
  onSelect,
  onMove,
}: {
  slot: number
  item?: InventoryItem | null
  label?: string
  isArmor?: boolean
  selected?: boolean
  busy?: boolean
  onSelect?: (item: InventoryItem) => void
  onMove?: (fromSlot: number, toSlot: number) => void
}) {
  const [over, setOver] = useState(false)

  const handleDragStart = (event: DragEvent) => {
    if (!item) return
    event.dataTransfer.setData('text/plain', String(item.slot))
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleDrop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    const fromRaw = event.dataTransfer.getData('text/plain')
    const from = Number(fromRaw)
    if (!Number.isNaN(from) && from !== slot && onMove) onMove(from, slot)
  }

  return (
    <div
      className={`inv-cell${item ? ' has-item' : ''}${selected ? ' selected' : ''}${over ? ' drag-over' : ''}${isArmor ? ' armor' : ''}${busy ? ' busy' : ''}`}
      title={item ? `${item.display_name || item.name} x${item.count} · 格子 ${item.slot}` : (label || `格子 ${slot}`)}
      draggable={!!item && !busy}
      onDragStart={handleDragStart}
      onDragOver={(event) => { event.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      onClick={() => { if (item && onSelect) onSelect(item) }}
    >
      {item ? (
        <>
          <ItemImage name={item.name} size={isArmor ? 30 : 36} />
          <span className="inv-count">{item.count}</span>
          {item.slot >= 36 && item.slot <= 44 ? <span className="inv-hotbar-mark" /> : null}
        </>
      ) : null}
    </div>
  )
}

function RemoveSlot({ busy, onRemove }: { busy?: boolean; onRemove: (slot: number) => void }) {
  const [over, setOver] = useState(false)
  return (
    <div
      className={`inv-remove-cell${over ? ' drag-over' : ''}${busy ? ' busy' : ''}`}
      title="移除物品：拖拽物品到这里将扔掉整组"
      aria-label="移除物品"
      onDragOver={(event) => { event.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        const slot = Number(event.dataTransfer.getData('text/plain'))
        if (!Number.isNaN(slot)) onRemove(slot)
      }}
    >
      <span className="inv-remove-x" aria-hidden="true">×</span>
      <small>移除</small>
    </div>
  )
}

export function InventoryModal({ botId, botName, onClose, onToast }: InventoryModalProps) {
  const [inventory, setInventory] = useState<BotInventory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<InventoryItem | null>(null)
  const [tossCount, setTossCount] = useState('1')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setInventory(await fetchBotInventory(botId))
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取库存')
    } finally {
      setLoading(false)
    }
  }, [botId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const bySlot = useMemo(() => {
    const map = new Map<number, InventoryItem>()
    for (const item of inventory?.items ?? []) map.set(item.slot, item)
    for (const item of inventory?.armor ?? []) map.set(item.slot, item)
    if (inventory?.offhand) map.set(inventory.offhand.slot, inventory.offhand)
    return map
  }, [inventory])

  const runTask = async (task: string, params: Record<string, unknown>, successText: string) => {
    setBusy(true)
    try {
      await sendCommand(botId, { type: 'run_task', task, params })
      onToast(successText, 'success')
      setSelected(null)
      setTimeout(() => void refresh(), 1500)
    } catch (e) {
      onToast(e instanceof Error ? e.message : '操作失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  /** 拖拽放置：从 sourceSlot 移到 targetSlot */
  const handleMove = async (sourceSlot: number, targetSlot: number) => {
    if (sourceSlot === targetSlot) return
    const source = bySlot.get(sourceSlot)
    if (!source) return
    await runTask('move_item', { from_slot: sourceSlot, to_slot: targetSlot }, `已命令 ${botName} 移动 ${source.display_name || source.name} → 格子 ${targetSlot}`)
  }

  const onToss = (event: FormEvent) => {
    event.preventDefault()
    if (!selected) return
    void runTask('toss_item', { item: selected.name, count: Number(tossCount) || 1 }, `已命令 ${botName} 扔出 ${selected.display_name || selected.name} x${Number(tossCount) || 1}`)
  }

  const onTossAll = (item: InventoryItem) => {
    void runTask('toss_item', { item: item.name, count: item.count }, `已命令 ${botName} 扔出全部 ${item.display_name || item.name}`)
  }

  const onRemoveSlot = (slot: number) => {
    const item = bySlot.get(slot)
    if (item) onTossAll(item)
  }

  const armorSlots = [5, 6, 7, 8] // boots/leggings/chestplate/helmet
  const armorNames = ['靴子', '护腿', '胸甲', '头盔']
  const offhandSlot = 45
  const backpackSlots = useMemo(() => {
    const slots: number[] = []
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 9; col++) slots.push(9 + row * 9 + col)
    }
    return slots
  }, [])
  const hotbarSlots = useMemo(() => Array.from({ length: 9 }, (_, index) => 36 + index), [])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="inventory-modal" onClick={(event) => event.stopPropagation()}>
        <header className="inventory-modal-header">
          <h3><Package size={16} /> {botName} 的背包</h3>
          <div className="inventory-modal-actions">
            <button className="icon-button" title="刷新" aria-label="刷新库存" onClick={() => void refresh()} disabled={loading || busy}>
              <RefreshCw className={loading ? 'is-spinning' : ''} size={15} />
            </button>
            <button className="icon-button" title="关闭" aria-label="关闭" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
        </header>

        {loading && !inventory ? (
          <div className="inventory-loading"><Loader2 className="is-spinning" size={18} /> 正在读取背包…</div>
        ) : error ? (
          <div className="inline-notice error">{error}</div>
        ) : (
          <>
            <div className="inv-body">
              {/* 盔甲列 */}
              <div className="inv-armor-col">
                {armorSlots.map((slot, index) => (
                  <SlotCell
                    key={slot}
                    slot={slot}
                    item={bySlot.get(slot)}
                    label={armorNames[index]}
                    isArmor
                    selected={selected?.slot === slot}
                    busy={busy}
                    onSelect={setSelected}
                    onMove={(from, to) => void handleMove(from, to)}
                  />
                ))}
                <SlotCell
                  slot={offhandSlot}
                  item={bySlot.get(offhandSlot)}
                  label="副手"
                  isArmor
                  selected={selected?.slot === offhandSlot}
                  busy={busy}
                  onSelect={setSelected}
                  onMove={(from, to) => void handleMove(from, to)}
                />
                <RemoveSlot busy={busy} onRemove={onRemoveSlot} />
              </div>

              {/* 主背包 */}
              <div className="inv-main">
                <div className="inv-section-label">背包</div>
                <div className="inv-grid">
                  {backpackSlots.map((slot) => (
                    <SlotCell
                      key={slot}
                      slot={slot}
                      item={bySlot.get(slot)}
                      selected={selected?.slot === slot}
                      busy={busy}
                      onSelect={setSelected}
                      onMove={(from, to) => void handleMove(from, to)}
                    />
                  ))}
                </div>
                <div className="inv-section-label">快捷栏</div>
                <div className="inv-grid">
                  {hotbarSlots.map((slot) => (
                    <SlotCell
                      key={slot}
                      slot={slot}
                      item={bySlot.get(slot)}
                      selected={selected?.slot === slot}
                      busy={busy}
                      onSelect={setSelected}
                      onMove={(from, to) => void handleMove(from, to)}
                    />
                  ))}
                </div>
                <p className="inv-hint">拖拽物品到另一个格子移动 · 移除格在左下角 · 点击选中后可在下方操作</p>
              </div>
            </div>

            {/* 操作区 */}
            <div className="inv-actions">
              {selected ? (
                <div className="inv-selected">
                  <ItemImage name={selected.name} size={26} />
                  <span className="inv-selected-name">{selected.display_name || selected.name} <em>x{selected.count} · 格子 {selected.slot}</em></span>
                  <button className="command-button small danger" onClick={() => void onTossAll(selected)} disabled={busy}>
                    <Trash2 size={13} /> 全部扔出
                  </button>
                </div>
              ) : (
                <div className="inv-selected empty">点击物品以操作，或拖拽到其他格子</div>
              )}
              <form className="inventory-toss-form" onSubmit={onToss}>
                <input
                  value={tossCount}
                  onChange={(event) => setTossCount(event.target.value)}
                  placeholder="数量"
                  type="number"
                  min={1}
                  disabled={busy || !selected}
                />
                <button className="command-button primary" type="submit" disabled={busy || !selected}>
                  {busy ? '执行中…' : `扔出${selected ? ` ${selected.display_name || selected.name}` : ''}`}
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
