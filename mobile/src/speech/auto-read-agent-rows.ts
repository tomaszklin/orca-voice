import { z } from 'zod'
import { isRecord } from '../../../src/shared/agent-status/child-work/agent-status-child-work-value-guards'
import { AGENT_STATUS_STATES } from '../../../src/shared/agent-status/contracts/agent-status-types'
import { mainAgentState } from '../../../src/shared/agent-status/lifecycle/main-agent-status'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/worktree/catalog/runtime-worktree-contracts'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { worktreeCatalogRead } from '../worktree/catalog/worktree-catalog-operations'
import type { AgentPane } from './chat-message-feeds'

/** The fields of a `worktree.ps` agent row that auto-read reads. */
export type SpokenAgentRow = Pick<
  RuntimeWorktreeAgentRow,
  | 'paneKey'
  | 'parentPaneKey'
  | 'state'
  | 'stateStartedAt'
  | 'mainAgent'
  | 'lastAssistantMessage'
  | 'toolName'
> & { subagents?: readonly { state: string }[] }

export type AutoReadAgentRow = SpokenAgentRow & {
  rawPaneKey: string
  worktreeId: string | null
  /** Repo or folder-workspace name, said before a message. */
  project: string | null
  /** The session's name as desktop shows it; the car lists it. */
  title: string | null
  /** The agent's terminal handle or chat address, where a reply from the car goes; old hosts omit it. */
  address?: string
  /** When the row last changed, by the host's clock; the car lists recent work first. */
  updatedAt?: number
}

const stateSchema = z.enum(AGENT_STATUS_STATES)
const mainAgentSchema = z.object({ state: stateSchema, stateStartedAt: z.number() })

// Why: a row in a state this build does not know is skipped rather than misread.
const agentRowSchema = z.object({
  paneKey: z.string(),
  parentPaneKey: z.string().nullable().catch(null),
  state: stateSchema,
  stateStartedAt: z.number(),
  lastAssistantMessage: z.string().nullable().catch(null),
  toolName: z.string().nullable().catch(null),
  // Why: an unreadable main agent falls back to the row's state, as rows from older hosts do.
  mainAgent: mainAgentSchema.optional().catch(undefined),
  subagents: z
    .array(z.object({ state: z.string() }))
    .optional()
    .catch(undefined),
  address: z.string().optional().catch(undefined),
  updatedAt: z.number().optional().catch(undefined),
  conversationName: z.string().nullish().catch(null),
  displayName: z.string().nullish().catch(null),
  taskTitle: z.string().nullish().catch(null),
  agentType: z.string().nullish().catch(null)
})

/** A worktree `worktree.ps` listed, for the car's project list. */
export type HostWorktree = {
  worktreeId: string
  project: string
  isMain: boolean
  lastActivityAt: number
}

const hostWorktrees = new Map<string, readonly HostWorktree[]>()

/** The worktrees `worktree.ps` last listed on a host, archived ones left out. */
export function latestHostWorktrees(hostId: string): readonly HostWorktree[] {
  return hostWorktrees.get(hostId) ?? []
}

function worktreesFromWorktreePs(worktrees: readonly unknown[]): HostWorktree[] {
  return worktrees.flatMap((worktree) => {
    const project = isRecord(worktree) ? worktreeProjectName(worktree) : null
    if (!isRecord(worktree) || !project || worktree.isArchived === true) {
      return []
    }
    const { worktreeId, isMainWorktree, lastActivityAt } = worktree
    return typeof worktreeId === 'string'
      ? [
          {
            worktreeId,
            project,
            isMain: isMainWorktree === true,
            lastActivityAt: typeof lastActivityAt === 'number' ? lastActivityAt : 0
          }
        ]
      : []
  })
}

function worktreeProjectName(worktree: Record<string, unknown>): string | null {
  const name =
    typeof worktree.repo === 'string' && worktree.repo ? worktree.repo : worktree.displayName
  return typeof name === 'string' && name ? name : null
}

// Why: pane keys are only unique within one host, so they get the host id as a prefix.
export function agentRowsFromWorktreePs(
  hostId: string,
  worktrees: readonly unknown[]
): AutoReadAgentRow[] {
  const rows: AutoReadAgentRow[] = []
  for (const worktree of worktrees) {
    if (!isRecord(worktree) || !Array.isArray(worktree.agents)) {
      continue
    }
    const { worktreeId } = worktree
    const project = worktreeProjectName(worktree)
    for (const entry of worktree.agents) {
      const parsed = agentRowSchema.safeParse(entry)
      if (!parsed.success) {
        continue
      }
      const { conversationName, displayName, taskTitle, agentType, ...agent } = parsed.data
      rows.push({
        ...agent,
        title: conversationName || displayName || taskTitle || agentType || null,
        paneKey: `${hostId}:${agent.paneKey}`,
        parentPaneKey: agent.parentPaneKey ? `${hostId}:${agent.parentPaneKey}` : null,
        rawPaneKey: agent.paneKey,
        worktreeId: typeof worktreeId === 'string' ? worktreeId : null,
        project
      })
    }
  }
  return rows
}

export async function readAgentRows(
  hostId: string,
  client: RpcClient
): Promise<AutoReadAgentRow[]> {
  const catalog = worktreeCatalogRead.interpret(await worktreeCatalogRead.request(client, {}))
  if (!catalog.accepted) {
    throw new Error('worktree.ps refused')
  }
  hostWorktrees.set(hostId, worktreesFromWorktreePs(catalog.value.worktrees ?? []))
  return agentRowsFromWorktreePs(hostId, catalog.value.worktrees ?? [])
}

export function agentPanes(rows: readonly AutoReadAgentRow[]): AgentPane[] {
  return rows.flatMap((row) => {
    if (row.parentPaneKey || !row.worktreeId) {
      return []
    }
    const working = mainAgentState(row) === 'working'
    const turnStartedAt = working ? (row.mainAgent?.stateStartedAt ?? row.stateStartedAt) : null
    return [
      {
        paneKey: row.paneKey,
        rawPaneKey: row.rawPaneKey,
        worktreeId: row.worktreeId,
        turnStartedAt
      }
    ]
  })
}
