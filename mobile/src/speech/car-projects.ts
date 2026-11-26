import type { HostWorktree } from './auto-read-agent-rows'

// Orca Voice fork: the projects Orca's car screens list, with or without sessions (owner, 2026-11-26).

export type CarProject = {
  hostId: string
  name: string
  lastActive: number
  worktreeId: string | null
}

export type CarSessionActivity = {
  hostId: string
  project: string
  lastActive: number
  worktreeId: string | null
}

type Draft = CarProject & { pick: { main: boolean; at: number } | null }

/**
 * Each host's projects, most recently active first. A new chat from the car goes to the project's
 * main worktree, else to its most recently active one.
 */
export function carProjects(
  hostIds: readonly string[],
  worktreesOf: (hostId: string) => readonly HostWorktree[],
  sessions: readonly CarSessionActivity[]
): CarProject[] {
  return hostIds.flatMap((hostId) => {
    const byName = new Map<string, Draft>()
    const draft = (name: string): Draft =>
      byName.get(name) ?? { hostId, name, lastActive: 0, worktreeId: null, pick: null }
    for (const worktree of worktreesOf(hostId)) {
      const project = draft(worktree.project)
      project.lastActive = Math.max(project.lastActive, worktree.lastActivityAt)
      const pick = project.pick
      if (
        !pick ||
        (worktree.isMain && !pick.main) ||
        (worktree.isMain === pick.main && worktree.lastActivityAt > pick.at)
      ) {
        project.worktreeId = worktree.worktreeId
        project.pick = { main: worktree.isMain, at: worktree.lastActivityAt }
      }
      byName.set(worktree.project, project)
    }
    for (const session of sessions) {
      if (session.hostId === hostId) {
        const project = draft(session.project)
        project.lastActive = Math.max(project.lastActive, session.lastActive)
        project.worktreeId ??= session.worktreeId
        byName.set(session.project, project)
      }
    }
    return [...byName.values()]
      .sort((a, b) => b.lastActive - a.lastActive)
      .map(({ pick: _pick, ...project }) => project)
  })
}
