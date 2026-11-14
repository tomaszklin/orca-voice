import { describe, expect, it } from 'vitest'
import { projectFirstPlace, projectFirstTitle, shownBranchName } from './project-first-labels'

describe('project-first labels', () => {
  it('names a main checkout after its project, not its branch', () => {
    const title = projectFirstTitle({
      name: 'main',
      repo: 'OrcaVoice',
      branch: 'refs/heads/main'
    })
    expect(title).toBe('OrcaVoice')
    expect(shownBranchName('refs/heads/main', title)).toBe('')
  })

  it('keeps a feature branch name and does not repeat it below', () => {
    const title = projectFirstTitle({
      name: 'read-aloud',
      repo: 'OrcaVoice',
      branch: 'read-aloud'
    })
    expect(title).toBe('read-aloud')
    expect(shownBranchName('read-aloud', title)).toBe('')
  })

  it('keeps a name someone set', () => {
    const title = projectFirstTitle({
      name: 'Phone app',
      repo: 'OrcaVoice',
      branch: 'main'
    })
    expect(title).toBe('Phone app')
    expect(shownBranchName('main', title)).toBe('')
    expect(shownBranchName('fix-x', title)).toBe('fix-x')
  })

  it('puts the project first in the agent footer', () => {
    expect(
      projectFirstPlace({
        workspaceName: 'main',
        repo: 'OrcaVoice',
        branch: 'main'
      })
    ).toBe('OrcaVoice')
    expect(
      projectFirstPlace({
        workspaceName: 'Phone app',
        repo: 'OrcaVoice',
        branch: 'main'
      })
    ).toBe('OrcaVoice · Phone app')
  })
})
