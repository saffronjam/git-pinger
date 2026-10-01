import { describe, expect, test } from 'bun:test'
import { parseGitLabActivity } from './gitlab-activity'

function parse(body: string, system = true) {
  return parseGitLabActivity({
    id: 'note:1',
    body,
    system,
    actor: { id: 1, username: 'alice' },
    createdAt: '2026-10-01T10:00:00Z',
  })
}

describe('GitLab activity parsing', () => {
  test('separates added and removed reviewers with multiple targets', () => {
    expect(
      parse(
        'requested review from @alice, @bob, and @carol and removed review request for @dan and @eve',
      ).map(({ kind, target }) => [kind, target.username]),
    ).toEqual([
      ['review_requested', 'alice'],
      ['review_requested', 'bob'],
      ['review_requested', 'carol'],
      ['review_removed', 'dan'],
      ['review_removed', 'eve'],
    ])
  })

  test('assignee changes preserve the actor and exclude existing assignees', () => {
    const result = parse('assigned to @bob additionally to @alice')
    expect(result).toHaveLength(1)
    expect(result[0]!.target.username).toBe('bob')
    expect(result[0]!.actor?.username).toBe('alice')
    expect(
      parse('assigned to @alice and @bob and unassigned @carol').map((event) => event.kind),
    ).toEqual(['assigned', 'assigned', 'unassigned'])
  })

  test('re-request with approval removal remains a review request', () => {
    expect(parse('requested review from @alice and removed approval')[0]!.kind).toBe(
      'review_requested',
    )
  })

  test.each(['approved this merge request', 'left review comments', 'requested changes'])(
    'recognizes completion: %s',
    (body) => {
      expect(parse(body)[0]).toMatchObject({
        kind: 'review_completed',
        target: { id: 1, username: 'alice' },
      })
    },
  )

  test('never interprets ordinary comments as system activity', () => {
    expect(parse('requested review from @alice', false)).toEqual([])
    expect(parse('approved this merge request', false)).toEqual([])
  })

  test.each([
    'requested review from @alice please',
    'custom event @alice',
    'requested review from @alice and unknown action',
    'assigned to @alice additionally to ???',
  ])('unrecognized syntax stays unattributed: %s', (body) => expect(parse(body)).toEqual([]))

  test('preserves full username tokens including dots and hyphens', () => {
    expect(
      parse('requested review from @alice-other and @bob.name').map(
        (event) => event.target.username,
      ),
    ).toEqual(['alice-other', 'bob.name'])
  })
})
