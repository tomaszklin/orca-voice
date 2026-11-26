import { describe, expect, it } from 'vitest'
import { carProjects } from './car-projects'

describe('carProjects', () => {
  it('lists projects without sessions too, newest activity first, new chats in the main worktree', () => {
    const worktrees = [
      { worktreeId: 'orca-main', project: 'Orca', isMain: true, lastActivityAt: 10 },
      { worktreeId: 'orca-branch', project: 'Orca', isMain: false, lastActivityAt: 50 },
      { worktreeId: 'quiet-main', project: 'Quiet', isMain: true, lastActivityAt: 20 }
    ]
    const sessions = [{ hostId: 'home', project: 'Busy', lastActive: 40, worktreeId: 'busy-main' }]
    expect(carProjects(['home'], () => worktrees, sessions)).toEqual([
      { hostId: 'home', name: 'Orca', lastActive: 50, worktreeId: 'orca-main' },
      { hostId: 'home', name: 'Busy', lastActive: 40, worktreeId: 'busy-main' },
      { hostId: 'home', name: 'Quiet', lastActive: 20, worktreeId: 'quiet-main' }
    ])
  })
})
