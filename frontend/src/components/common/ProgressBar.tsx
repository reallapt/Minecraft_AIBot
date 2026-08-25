interface ProgressBarProps {
  value: number
  label?: string
}

export function ProgressBar({ value, label }: ProgressBarProps) {
  const percentage = Math.max(0, Math.min(100, value))
  return (
    <div className="progress-inline" aria-label={label ? `${label} ${Math.round(percentage)}%` : `${Math.round(percentage)}%`}>
      {label ? <span>{label}</span> : null}
      <span className="progress-value">{Math.round(percentage)}%</span>
    </div>
  )
}
