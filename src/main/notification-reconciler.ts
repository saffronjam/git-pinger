export interface ActivityUser {
  id?: number
  username: string
}

export type AssignmentRole = 'assigned' | 'review'

export interface AssignmentActivity {
  id: string
  kind: 'assigned' | 'unassigned' | 'review_requested' | 'review_removed' | 'review_completed'
  actor: ActivityUser | null
  target: ActivityUser
  timestamp: string
}

export interface AssignmentState {
  present: boolean
  requestId: string | null
  observedAt: string
  fallbackThrough: string | null
  occurrence: number
}

export interface AssignmentObservation {
  role: AssignmentRole
  present: boolean
  activities: readonly AssignmentActivity[] | null
  reviewState: 'pending' | 'completed' | 'unknown'
  observedAt: string
}

export interface AssignmentDecision {
  state: AssignmentState
  notify: boolean
  reason: 'baseline' | 'unchanged' | 'withdrawn' | 'completed' | 'self' | 'external' | 'unknown'
  actor: string
  occurrenceId: string
  timestamp: string
}

/**
 * Compares provider identities, preferring immutable user IDs.
 * @param left First identity, or an unavailable actor.
 * @param right Second identity.
 * @returns Whether both identities identify the same account.
 */
export function sameUser(left: ActivityUser | null, right: ActivityUser): boolean {
  if (!left) return false
  if (left.id !== undefined && right.id !== undefined) return left.id === right.id
  return left.username.toLowerCase() === right.username.toLowerCase()
}

/**
 * Creates history for a role absent from the last successful snapshot.
 * @param observedAt Time of that snapshot.
 * @returns An empty assignment history.
 */
export function emptyAssignmentState(observedAt: string): AssignmentState {
  return { present: false, requestId: null, observedAt, fallbackThrough: null, occurrence: 0 }
}

function compareActivity(left: AssignmentActivity, right: AssignmentActivity): number {
  return (
    Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
    left.id.localeCompare(right.id, 'en', { numeric: true })
  )
}

/**
 * Reconciles observed membership and activity without performing I/O or mutating history.
 * @param previous History from the last successful membership observation.
 * @param observation Current membership and any available attribution evidence.
 * @param user Authenticated account.
 * @param silent Whether this scope is establishing its initial baseline.
 * @returns Updated history and a notification decision, including suppression reasons.
 */
export function reconcileAssignment(
  previous: AssignmentState,
  observation: AssignmentObservation,
  user: ActivityUser,
  silent: boolean,
): AssignmentDecision {
  const requestKind = observation.role === 'assigned' ? 'assigned' : 'review_requested'
  const removalKind = observation.role === 'assigned' ? 'unassigned' : 'review_removed'
  const activities = (observation.activities ?? [])
    .filter(
      (activity) =>
        sameUser(activity.target, user) &&
        Number.isFinite(Date.parse(activity.timestamp)) &&
        (activity.kind === requestKind ||
          activity.kind === removalKind ||
          (observation.role === 'review' && activity.kind === 'review_completed')),
    )
    .toSorted(compareActivity)
  const request = activities.findLast((activity) => activity.kind === requestKind)
  const latest = activities.at(-1)
  const appeared = observation.present && !previous.present
  const recovered =
    request !== undefined &&
    previous.fallbackThrough !== null &&
    Date.parse(request.timestamp) <= Date.parse(previous.fallbackThrough)
  const previousSecond = Math.floor(Date.parse(previous.observedAt) / 1000) * 1000
  const attributable =
    request !== undefined && (!appeared || Date.parse(request.timestamp) >= previousSecond)
  const newRequest = attributable && request.id !== previous.requestId && !recovered
  const candidate = observation.present && (appeared || newRequest)
  const occurrence = previous.occurrence + (candidate ? 1 : 0)
  const actor = attributable ? request.actor : null
  const state: AssignmentState = {
    present: observation.present,
    requestId: request?.id ?? previous.requestId,
    observedAt: observation.observedAt,
    fallbackThrough: !observation.present
      ? null
      : (appeared || silent) && !attributable
        ? observation.observedAt
        : previous.fallbackThrough,
    occurrence,
  }
  const result: AssignmentDecision = {
    state,
    notify: false,
    reason: 'unchanged',
    actor: actor?.username ?? 'Someone',
    occurrenceId: attributable ? request.id : `membership:${observation.observedAt}:${occurrence}`,
    timestamp: attributable ? request.timestamp : observation.observedAt,
  }
  if (silent) return { ...result, reason: 'baseline' }
  if (!candidate) return result

  const relevantLatest =
    latest && (!appeared || Date.parse(latest.timestamp) >= previousSecond) ? latest : undefined
  if (relevantLatest?.kind === removalKind) return { ...result, reason: 'withdrawn' }
  if (
    observation.role === 'review' &&
    (observation.reviewState === 'completed' || relevantLatest?.kind === 'review_completed')
  ) {
    return { ...result, reason: 'completed' }
  }
  if (sameUser(actor, user)) return { ...result, reason: 'self' }
  return { ...result, notify: true, reason: actor ? 'external' : 'unknown' }
}
