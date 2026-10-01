import type { ActivityUser, AssignmentActivity } from './notification-reconciler'

export interface GitLabActivityNote {
  id: string
  body: string
  actor: ActivityUser | null
  createdAt: string
  system: boolean
}

function parseUsers(value: string): ActivityUser[] | null {
  const tokens = value.split(/,\s*(?:and\s+)?|\s+and\s+/)
  if (!tokens.length || tokens.some((token) => !/^@[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(token))) {
    return null
  }
  return tokens.map((token) => ({ username: token.slice(1) }))
}

/**
 * Decodes known GitLab system-note forms without trusting ordinary comment text.
 * @param note Provider note with its system flag, author, and creation timestamp.
 * @returns Typed assignment or review activities; unsupported formats remain unattributed.
 */
export function parseGitLabActivity(note: GitLabActivityNote): AssignmentActivity[] {
  if (!note.system) return []
  const base = { id: note.id, actor: note.actor, timestamp: note.createdAt }
  if (
    note.actor &&
    [
      'approved this merge request',
      'left review comments',
      'requested changes',
      'requested changes to this merge request',
    ].includes(note.body)
  ) {
    return [{ ...base, kind: 'review_completed', target: note.actor }]
  }

  const clauses: Array<{ prefix: string; kind: AssignmentActivity['kind'] }> = [
    { prefix: 'requested review from ', kind: 'review_requested' },
    { prefix: 'removed review request for ', kind: 'review_removed' },
    { prefix: 'assigned to ', kind: 'assigned' },
    { prefix: 'unassigned ', kind: 'unassigned' },
  ]
  const pieces = note.body.split(/ and (?=removed review request for |unassigned )/)
  const result: AssignmentActivity[] = []
  for (let piece of pieces) {
    if (piece.endsWith(' and removed approval')) {
      if (!piece.startsWith('requested review from ')) return []
      piece = piece.slice(0, -' and removed approval'.length)
    }
    const clause = clauses.find(({ prefix }) => piece.startsWith(prefix))
    if (!clause) return []
    const assignmentParts = piece.slice(clause.prefix.length).split(' additionally to ')
    if (assignmentParts.length > 2) return []
    const [targets, existing] = assignmentParts
    if (existing !== undefined && (clause.kind !== 'assigned' || !parseUsers(existing))) return []
    const users = parseUsers(targets ?? '')
    if (!users) return []
    result.push(...users.map((target) => ({ ...base, kind: clause.kind, target })))
  }
  return result
}
