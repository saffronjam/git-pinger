import { describe, expect, test } from 'bun:test'
import { emptyAssignmentState, reconcileAssignment, sameUser } from './notification-reconciler'
import type {
  ActivityUser,
  AssignmentActivity,
  AssignmentObservation,
} from './notification-reconciler'

const me = { id: 1, username: 'alice' }
const other = { id: 2, username: 'bob' }
const t0 = '2026-10-01T10:00:00.000Z'
const t1 = '2026-10-01T10:01:00.000Z'
const t2 = '2026-10-01T10:02:00.000Z'
const t3 = '2026-10-01T10:03:00.000Z'

function activity(
  id: number,
  actor: ActivityUser | null = other,
  kind: AssignmentActivity['kind'] = 'review_requested',
  timestamp = t1,
): AssignmentActivity {
  return { id: `event:${id}`, actor, target: me, kind, timestamp }
}

function observation(
  activities: readonly AssignmentActivity[] | null,
  overrides: Partial<AssignmentObservation> = {},
): AssignmentObservation {
  return {
    role: 'review',
    present: true,
    activities,
    reviewState: 'unknown',
    observedAt: t2,
    ...overrides,
  }
}

describe('assignment reconciliation', () => {
  test('second-resolution provider timestamps still attribute actions in the same second', () => {
    const previous = emptyAssignmentState('2026-10-01T10:01:00.250Z')
    expect(reconcileAssignment(previous, observation([activity(1, me)]), me, false).reason).toBe(
      'self',
    )
  })
  test.each(['assigned', 'review'] as const)('suppresses self %s and retains history', (role) => {
    const own = activity(1, me, role === 'assigned' ? 'assigned' : 'review_requested')
    const input = observation([own], { role })
    const first = reconcileAssignment(emptyAssignmentState(t0), input, me, false)
    expect(first.reason).toBe('self')
    expect(first.notify).toBe(false)
    expect(reconcileAssignment(first.state, input, me, false).reason).toBe('unchanged')
  })

  test('external request uses the actor and event timestamp', () => {
    const result = reconcileAssignment(
      emptyAssignmentState(t0),
      observation([activity(1)]),
      me,
      false,
    )
    expect(result.notify).toBe(true)
    expect(result.actor).toBe('bob')
    expect(result.timestamp).toBe(t1)
  })

  test('completed review state suppresses automatic reviewer membership without notes', () => {
    const input = observation([], { reviewState: 'completed' })
    const result = reconcileAssignment(emptyAssignmentState(t0), input, me, false)
    expect(result.reason).toBe('completed')
    expect(result.notify).toBe(false)
    expect(
      reconcileAssignment(result.state, observation([], { reviewState: 'pending' }), me, false)
        .notify,
    ).toBe(false)
  })

  test('completion evidence suppresses an earlier request even without the reviewer endpoint', () => {
    const input = observation([activity(1), activity(2, me, 'review_completed', t2)])
    expect(reconcileAssignment(emptyAssignmentState(t0), input, me, false).reason).toBe('completed')
  })

  test('later re-request notifies while reviewer membership stays unchanged', () => {
    const completed = reconcileAssignment(
      emptyAssignmentState(t0),
      observation([activity(1, me), activity(2, me, 'review_completed', t2)]),
      me,
      false,
    )
    const result = reconcileAssignment(
      completed.state,
      observation(
        [
          activity(1, me),
          activity(2, me, 'review_completed', t2),
          activity(3, other, 'review_requested', t3),
        ],
        { observedAt: t3, reviewState: 'pending' },
      ),
      me,
      false,
    )
    expect(result.notify).toBe(true)
    expect(result.actor).toBe('bob')
  })

  test('removal and reassignment between polls are separate occurrences', () => {
    const initial = reconcileAssignment(
      emptyAssignmentState(t0),
      observation([activity(1)]),
      me,
      true,
    )
    const result = reconcileAssignment(
      initial.state,
      observation(
        [
          activity(1),
          activity(2, other, 'review_removed', t2),
          activity(3, other, 'review_requested', t3),
        ],
        { observedAt: t3 },
      ),
      me,
      false,
    )
    expect(result.notify).toBe(true)
    expect(result.occurrenceId).toBe('event:3')
  })

  test('a withdrawn request cannot notify from a stale membership response', () => {
    expect(
      reconcileAssignment(
        emptyAssignmentState(t0),
        observation([activity(1), activity(2, other, 'review_removed', t2)]),
        me,
        false,
      ).reason,
    ).toBe('withdrawn')
  })

  test('activity targeting somebody else cannot suppress the actual request', () => {
    const unrelated = { ...activity(2, me, 'review_requested', t2), target: other }
    const result = reconcileAssignment(
      emptyAssignmentState(t0),
      observation([activity(1), unrelated]),
      me,
      false,
    )
    expect(result.notify).toBe(true)
    expect(result.actor).toBe('bob')
  })

  test('old self-assignment is not evidence for a new membership occurrence', () => {
    const result = reconcileAssignment(
      emptyAssignmentState(t2),
      observation([activity(1, me)], { observedAt: t3 }),
      me,
      false,
    )
    expect(result.notify).toBe(true)
    expect(result.reason).toBe('unknown')
  })

  test.each([{ activities: null }, { activities: [] }])(
    'missing attribution notifies once with neutral wording: %j',
    ({ activities }) => {
      const result = reconcileAssignment(
        emptyAssignmentState(t0),
        observation(activities),
        me,
        false,
      )
      expect(result.notify).toBe(true)
      expect(result.actor).toBe('Someone')
      expect(reconcileAssignment(result.state, observation(activities), me, false).notify).toBe(
        false,
      )
    },
  )

  test('deleted actor is unknown, never assumed to be the PR author', () => {
    const result = reconcileAssignment(
      emptyAssignmentState(t0),
      observation([activity(1, null)]),
      me,
      false,
    )
    expect(result.reason).toBe('unknown')
    expect(result.notify).toBe(true)
  })

  test('recovered history aliases the fallback occurrence but preserves later requests', () => {
    const fallback = reconcileAssignment(emptyAssignmentState(t0), observation(null), me, false)
    const recovered = reconcileAssignment(fallback.state, observation([activity(1)]), me, false)
    expect(recovered.notify).toBe(false)
    const next = reconcileAssignment(
      recovered.state,
      observation([activity(1), activity(2, other, 'review_requested', t3)], { observedAt: t3 }),
      me,
      false,
    )
    expect(next.notify).toBe(true)
  })

  test('silent baseline does not replay activity fetched after an initial attribution failure', () => {
    const baseline = reconcileAssignment(emptyAssignmentState(t0), observation(null), me, true)
    expect(baseline.reason).toBe('baseline')
    expect(reconcileAssignment(baseline.state, observation([activity(1)]), me, false).notify).toBe(
      false,
    )
  })

  test('ordering uses source IDs when timestamps coincide', () => {
    const result = reconcileAssignment(
      emptyAssignmentState(t0),
      observation([activity(10, other), activity(9, me, 'review_completed')]),
      me,
      false,
    )
    expect(result.notify).toBe(true)
  })

  test('unknown timestamps cannot establish self-attribution', () => {
    const result = reconcileAssignment(
      emptyAssignmentState(t0),
      observation([activity(1, me, 'review_requested', 'invalid')]),
      me,
      false,
    )
    expect(result.reason).toBe('unknown')
  })

  test('user IDs take precedence over renamed or reused usernames', () => {
    expect(sameUser({ id: 1, username: 'renamed' }, me)).toBe(true)
    expect(sameUser({ id: 2, username: 'alice' }, me)).toBe(false)
    expect(sameUser({ username: 'ALICE' }, me)).toBe(true)
    expect(sameUser({ username: 'alice-two' }, me)).toBe(false)
  })
})
