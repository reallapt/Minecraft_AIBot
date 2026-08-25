import { useContext } from 'react'
import { ControlContext, type ControlContextValue } from './control-context'

export function useControl(): ControlContextValue {
  const context = useContext(ControlContext)
  if (!context) throw new Error('useControl must be used inside ControlProvider')
  return context
}
