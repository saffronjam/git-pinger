import { useCallback, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const LOOKBACK_OPTIONS = [
  { value: '0', label: 'Live (no lookback)' },
  { value: '1', label: '1 minute' },
  { value: '5', label: '5 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
]

interface LookbackSettingProps {
  value: number
  onChange: (minutes: number) => void
}

/** Lookback window selector for startup event fetching. */
export function LookbackSetting({ value, onChange }: LookbackSettingProps): ReactNode {
  const handleChange = useCallback(
    (val: string) => {
      onChange(Number(val))
    },
    [onChange],
  )

  return (
    <div className="flex items-center justify-between">
      <div>
        <Label>Lookback window</Label>
        <p className="text-xs text-muted-foreground">How far back to check on startup</p>
      </div>
      <Select value={String(value)} onValueChange={handleChange}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LOOKBACK_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
