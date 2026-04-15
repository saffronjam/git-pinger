import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTheme } from '@/hooks/use-theme'

/** Theme selector for light, dark, and system modes. */
export function ThemeSetting(): ReactNode {
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex items-center justify-between">
      <Label>Theme</Label>
      <Select value={theme} onValueChange={setTheme}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="light">Light</SelectItem>
          <SelectItem value="dark">Dark</SelectItem>
          <SelectItem value="system">System</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
