import { useCallback, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const INTERVAL_OPTIONS = [
  { value: '10', label: '10 seconds' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '1 minute' },
  { value: '120', label: '2 minutes' },
  { value: '300', label: '5 minutes' },
  { value: '600', label: '10 minutes' },
]

interface PollIntervalSettingProps {
  value: number
  onChange: (seconds: number) => void
}

/** Poll interval selector. */
export function PollIntervalSetting({ value, onChange }: PollIntervalSettingProps): ReactNode {
  const handleChange = useCallback(
    (val: string) => {
      onChange(Number(val))
    },
    [onChange],
  )

  return (
    <div className="flex items-center justify-between">
      <Label>Poll interval</Label>
      <Select value={String(value)} onValueChange={handleChange}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INTERVAL_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
