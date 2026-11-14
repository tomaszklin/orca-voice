/**
 * Orca Voice fork (owner's request, 2026-11-14): session lists lead with the project, not the
 * branch. Orca names a workspace after its branch until someone renames it, so a main checkout
 * shows as "main" on every row while the project name gets cut short. The owner rarely uses
 * branches, so a default branch says nothing and an automatic name is replaced by the project.
 */

const DEFAULT_BRANCHES = new Set(['main', 'master'])

export function shortBranchName(branch: string | null | undefined): string {
  return branch?.replace(/^refs\/heads\//, '').trim() ?? ''
}

/** A name worth showing next to the project: set by someone, not copied from branch or project. */
export function ownWorkspaceName(args: {
  name: string | null | undefined
  repo: string
  branch: string | null | undefined
}): string {
  const name = args.name?.trim() ?? ''
  return name === args.repo || name === shortBranchName(args.branch) ? '' : name
}

/** What a row is called: its own name, else its branch unless that is a default one, else the project. */
export function projectFirstTitle(args: {
  name: string | null | undefined
  repo: string
  branch: string | null | undefined
}): string {
  const branch = shortBranchName(args.branch)
  return (
    ownWorkspaceName(args) || (branch && !DEFAULT_BRANCHES.has(branch) ? branch : '') || args.repo
  )
}

/** The branch line under a row's title, or '' when it would repeat the title or name a default branch. */
export function shownBranchName(branch: string | null | undefined, title: string): string {
  const short = shortBranchName(branch)
  return short === title || DEFAULT_BRANCHES.has(short) ? '' : short
}

/** A workspace row's title and line below it; a folder workspace keeps its own line. */
export function projectFirstRowText(
  item: { displayName: string; repo: string; branch: string },
  folderMeta: string | null
): { title: string; metaText: string } {
  const branch = folderMeta === null ? item.branch : ''
  const title = projectFirstTitle({ name: item.displayName, repo: item.repo, branch })
  return { title, metaText: folderMeta ?? shownBranchName(branch, title) }
}

/** The agent row's footer: project first, then the workspace's own name if it has one. */
export function projectFirstPlace(args: {
  workspaceName: string
  repo: string
  branch: string | null | undefined
}): string {
  return [args.repo, ownWorkspaceName({ ...args, name: args.workspaceName })]
    .filter(Boolean)
    .join(' · ')
}
