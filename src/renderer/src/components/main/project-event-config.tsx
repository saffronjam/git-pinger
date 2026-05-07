import { useCallback, type ReactNode } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import type { NotificationEventFlags } from '../../../../shared/project'

interface ProjectEventConfigProps {
  events: NotificationEventFlags
  onUpdate: (events: NotificationEventFlags) => void
}

const EVENT_LABELS: { key: keyof NotificationEventFlags; label: string }[] = [
  { key: 'prCreated', label: 'PR created' },
  { key: 'prAssigned', label: 'Assigned to me' },
  { key: 'prReviewRequested', label: 'Review requested' },
  { key: 'prComment', label: 'PR comment' },
]

/** Per-project notification event toggle configuration. */
export function ProjectEventConfig({ events, onUpdate }: ProjectEventConfigProps): ReactNode {
  const toggle = useCallback(
    (key: keyof NotificationEventFlags) => {
      onUpdate({ ...events, [key]: !events[key] })
    },
    [events, onUpdate],
  )

  return (
    <div className="space-y-2 px-4 pb-3 pt-1">
      {EVENT_LABELS.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-3">
          <Label className="w-32 text-xs font-normal text-muted-foreground">{label}</Label>
          <Switch checked={events[key] ?? false} onCheckedChange={() => toggle(key)} />
        </div>
      ))}
    </div>
  )
}

/** Short labels for chips displayed on the project row. */
export const EVENT_CHIP_LABELS: Record<keyof NotificationEventFlags, string> = {
  prCreated: 'PR created',
  prAssigned: 'Assigned',
  prReviewRequested: 'Review',
  prComment: 'Comment',
}
