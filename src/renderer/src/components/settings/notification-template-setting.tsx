import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DEFAULT_TEMPLATES,
  type EventTemplate,
  type NotificationTemplates,
} from '../../../../shared/config'
import type { NotificationEventType } from '../../../../shared/notification'

interface NotificationTemplateSettingProps {
  templates: NotificationTemplates
}

const EVENT_CATEGORIES: { type: NotificationEventType; label: string }[] = [
  { type: 'pr_created', label: 'PR Created' },
  { type: 'pr_assigned', label: 'Assigned' },
  { type: 'pr_review_requested', label: 'Review' },
]

const VARIABLES = [
  { key: 'provider', example: 'GitHub' },
  { key: 'project', example: 'saffronjam/git-pinger' },
  { key: 'title', example: 'Fix login bug' },
  { key: 'author', example: 'octocat' },
  { key: 'url', example: 'https://github.com/...' },
]

const VALID_KEYS = new Set(VARIABLES.map((v) => v.key))

/** Renders template text with {{variables}} colored inline. */
function ColoredOverlay({ text }: { text: string }): ReactNode {
  const parts: ReactNode[] = []
  const regex = /(\{\{)(\w+)(\}\})/g
  let lastIndex = 0
  let match = regex.exec(text)
  let i = 0

  while (match) {
    if (match.index > lastIndex) {
      parts.push(<span key={`t${i}`}>{text.slice(lastIndex, match.index)}</span>)
    }
    const isValid = VALID_KEYS.has(match[2]!)
    parts.push(
      <span key={`v${i}`}>
        {'{{'}
        <span className={isValid ? 'text-sky-400' : 'text-red-400'}>{match[2]}</span>
        {'}}'}
      </span>,
    )
    i++
    lastIndex = match.index + match[0].length
    match = regex.exec(text)
  }

  if (lastIndex < text.length) {
    parts.push(<span key={`e${i}`}>{text.slice(lastIndex)}</span>)
  }

  return <>{parts}</>
}

interface TemplateInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>
  value: string
  onChange: (value: string) => void
}

/** Input with colored {{variable}} syntax highlighting via hidden input + synced overlay. */
function TemplateInput({ inputRef, value, onChange }: TemplateInputProps): ReactNode {
  const overlayRef = useRef<HTMLDivElement>(null)

  const syncScroll = useCallback(() => {
    if (inputRef.current && overlayRef.current) {
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft
    }
  }, [inputRef])

  return (
    <div className="relative h-9 rounded-md border border-input focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      <div
        ref={overlayRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre px-3 font-mono text-xs leading-9 text-foreground"
      >
        <ColoredOverlay text={value} />
      </div>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className="absolute inset-0 w-full bg-transparent px-3 font-mono text-xs leading-9 text-transparent caret-foreground outline-none"
      />
    </div>
  )
}

/** Expands {{key}} placeholders with example values. */
function expandTemplate(template: string): string {
  let result = template
  for (const v of VARIABLES) {
    result = result.replaceAll(`{{${v.key}}}`, v.example)
  }
  return result
}

interface CategoryEditorProps {
  eventType: NotificationEventType
  template: EventTemplate
  onSave: (eventType: NotificationEventType, template: EventTemplate) => void
}

/** Editor for a single event category's title and body templates. */
function CategoryEditor({ eventType, template, onSave }: CategoryEditorProps): ReactNode {
  const [title, setTitle] = useState(template.titleTemplate)
  const [body, setBody] = useState(template.bodyTemplate)

  useEffect(() => {
    setTitle(template.titleTemplate)
    setBody(template.bodyTemplate)
  }, [template.titleTemplate, template.bodyTemplate])
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLInputElement>(null)

  const save = useCallback(
    (newTitle: string, newBody: string) => {
      setTitle(newTitle)
      setBody(newBody)
      onSave(eventType, { titleTemplate: newTitle, bodyTemplate: newBody })
    },
    [eventType, onSave],
  )

  const insertVariable = useCallback(
    (key: string, inputRef: React.RefObject<HTMLInputElement | null>) => {
      const input = inputRef.current
      if (!input) return
      const start = input.selectionStart ?? input.value.length
      const end = input.selectionEnd ?? start
      const value = input.value
      const inserted = `{{${key}}}`
      const newValue = value.slice(0, start) + inserted + value.slice(end)

      if (inputRef === titleRef) {
        save(newValue, body)
      } else {
        save(title, newValue)
      }

      requestAnimationFrame(() => {
        input.focus()
        const cursor = start + inserted.length
        input.setSelectionRange(cursor, cursor)
      })
    },
    [title, body, save],
  )

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Title</Label>
        <TemplateInput inputRef={titleRef} value={title} onChange={(v) => save(v, body)} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Body</Label>
        <TemplateInput inputRef={bodyRef} value={body} onChange={(v) => save(title, v)} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Insert variable</Label>
        <div className="flex flex-wrap gap-1">
          {VARIABLES.map((v) => (
            <Badge
              key={v.key}
              variant="outline"
              className="cursor-pointer font-mono text-[10px] hover:bg-accent"
              onClick={() => {
                const focused = document.activeElement
                const ref =
                  focused === bodyRef.current
                    ? bodyRef
                    : focused === titleRef.current
                      ? titleRef
                      : bodyRef
                insertVariable(v.key, ref)
              }}
            >
              <span className="text-muted-foreground">{'{{'}</span>
              <span className="text-sky-400">{v.key}</span>
              <span className="text-muted-foreground">{'}}'}</span>
            </Badge>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Settings for customizing per-category notification templates. */
export function NotificationTemplateSetting({
  templates,
}: NotificationTemplateSettingProps): ReactNode {
  const [activeTab, setActiveTab] = useState<NotificationEventType>('pr_created')

  const handleSave = useCallback(
    (eventType: NotificationEventType, template: EventTemplate) => {
      const updated = { ...templates, [eventType]: template }
      window.api.config.setNotificationTemplates(updated)
    },
    [templates],
  )

  const handleReset = useCallback(() => {
    window.api.config.setNotificationTemplates(DEFAULT_TEMPLATES)
  }, [])

  const isDefault = JSON.stringify(templates) === JSON.stringify(DEFAULT_TEMPLATES)
  const activeTemplate = templates[activeTab]

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm">Notification templates</Label>
        <Button
          variant="ghost"
          size="sm"
          className={`h-6 text-xs ${isDefault ? 'invisible' : ''}`}
          onClick={handleReset}
        >
          <RotateCcw className="size-3" />
          Reset to default
        </Button>
      </div>

      <Tabs
        defaultValue="pr_created"
        onValueChange={(v) => setActiveTab(v as NotificationEventType)}
      >
        <div className="flex items-start gap-4">
          <TabsList>
            {EVENT_CATEGORIES.map((cat) => (
              <TabsTrigger key={cat.type} value={cat.type} className="text-xs">
                {cat.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex-1 rounded-md border bg-muted/50 px-3 py-2">
            <p className="text-sm font-semibold">{expandTemplate(activeTemplate.titleTemplate)}</p>
            <p className="text-xs text-muted-foreground">
              {expandTemplate(activeTemplate.bodyTemplate)}
            </p>
          </div>
        </div>
        {EVENT_CATEGORIES.map((cat) => (
          <TabsContent key={cat.type} value={cat.type} className="mt-3">
            <CategoryEditor
              eventType={cat.type}
              template={templates[cat.type]}
              onSave={handleSave}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
