// Node domains map 1-to-1 with the primary Neo4j label used in neocortex
// (the graph inside second-brain). New labels get added here as ingest
// pipelines land new node types.
export type NodeDomain =
  // People + orgs
  | "person"
  | "organization"
  // Memory kinds — the second-brain knowledge core
  | "memory"
  | "decision"
  | "spec"
  | "preference"
  | "task"
  | "retro"
  // Content
  | "message"
  | "document"
  | "meeting"
  // Work items
  | "issue"
  | "merge-request"
  | "commit"
  // Containers / scopes
  | "project"
  | "jira-project"
  | "confluence-space"
  | "figma-team"
  | "figma-project"
  | "channel"
  | "repo"
  // Catch-all for labels the wayfinder hasn't been taught yet. Neocortex
  // treats new labels as expected growth (docs/architecture/ontology.md +
  // schema-agent proposals) — dynamic discovery keeps nodes visible until
  // a first-class mapping lands.
  | "unknown";

export type GraphNodeStatus =
  | "active"
  | "blocked"
  | "complete"
  | "dismissed"
  | "idle"
  | "unread"
  | "waiting"
  | "draft";

export type Priority = "low" | "medium" | "high" | "urgent";

export interface SourceReference {
  system: string;
  externalId: string;
  url?: string;
}

// Populated on every node that came from Neo4j.
export interface BackendReference {
  store: "neo4j";
  elementId: string;
  labels?: string[];
  relationshipType?: string;
}

export interface BaseNode {
  id: string;
  domain: NodeDomain;
  label: string;
  status: GraphNodeStatus;
  source: SourceReference;
  backend?: BackendReference;
  metadata?: Record<string, unknown>;
  fixedPosition?: VectorTuple;
}

// :Person — identity records unified across sources.
export interface PersonNode extends BaseNode {
  domain: "person";
  displayName: string;
  primaryEmail?: string;
  kind?: string;         // human | bot | service
  isSelf?: boolean;
  handles?: Record<string, string>;   // handle_slack, handle_gitlab, ...
}

// :Organization — inferred from email domains + explicit ingests.
export interface OrganizationNode extends BaseNode {
  domain: "organization";
  orgName: string;
  domain_name?: string;   // the email domain, e.g. "acme.com"
  kind?: string;          // company | personal | unknown
}

// Common shape for the memory-kind nodes: Memory, Decision, Spec,
// Preference, Retro. Content is free-form prose captured by an agent.
export interface MemoryLikeNode extends BaseNode {
  domain: "memory" | "decision" | "spec" | "preference" | "retro";
  content: string;
  kindLabel?: string;
  signalType?: string;        // miss | noise | stale | duplicate | win (retros)
  reconciliationStatus?: string;
  activityStatus?: string;
}

// :Task — actionable to-do items captured by agents or extracted from sources.
export interface TaskNode extends BaseNode {
  domain: "task";
  title: string;
  details?: string;
  priority?: Priority;
  taskStatus?: string;    // open | closed | ...
  assignee?: string;
  origin?: string;
  dueAt?: string;
  notBefore?: string;
  confidence?: number;
  activityStatus?: string;
}

// :Message — email, Slack messages, Jira comments, GitLab notes.
export interface MessageNode extends BaseNode {
  domain: "message";
  subject?: string;
  content?: string;
  fromEmail?: string;
  timestamp?: string;
  threadId?: string;
  channelName?: string;
  labels?: string[];
}

// :Document — Confluence pages, Gmail blobs, Figma files, Zoom transcripts.
export interface DocumentNode extends BaseNode {
  domain: "document";
  title: string;
  webUrl?: string;
  kind?: string;
  spaceKey?: string;
  lastModified?: string;
}

// :Meeting — Zoom meetings.
export interface MeetingNode extends BaseNode {
  domain: "meeting";
  topic: string;
  startTime?: string;
  durationSec?: number;
  shareUrl?: string;
}

// :Issue — Jira issues and GitLab issues.
export interface IssueNode extends BaseNode {
  domain: "issue";
  key: string;
  summary: string;
  issueType?: string;
  issueStatus?: string;
  priority?: string;
  labels?: string[];
  projectKey?: string;
  webUrl?: string;
  updatedAt?: string;
}

// :MergeRequest — GitLab MRs.
export interface MergeRequestNode extends BaseNode {
  domain: "merge-request";
  key: string;
  title: string;
  state?: string;
  sourceBranch?: string;
  targetBranch?: string;
  projectPath?: string;
  webUrl?: string;
  labels?: string[];
}

// :Commit — GitLab commits.
export interface CommitNode extends BaseNode {
  domain: "commit";
  shortSha: string;
  content?: string;
  projectPath?: string;
  webUrl?: string;
  timestamp?: string;
}

// :Project — user-curated work scopes ("Turbine GA Launch").
export interface ProjectNode extends BaseNode {
  domain: "project";
  projectName: string;
  projectKey?: string;
}

// :JiraProject — Jira ticket containers.
export interface JiraProjectNode extends BaseNode {
  domain: "jira-project";
  projectName: string;
  jiraProjectKey?: string;
  description?: string;
}

// :ConfluenceSpace — Confluence doc containers.
export interface ConfluenceSpaceNode extends BaseNode {
  domain: "confluence-space";
  spaceName: string;
  spaceKey?: string;
  description?: string;
}

// :FigmaTeam — Figma teams.
export interface FigmaTeamNode extends BaseNode {
  domain: "figma-team";
  teamName: string;
  teamKey?: string;
}

// :FigmaProject — Figma projects.
export interface FigmaProjectNode extends BaseNode {
  domain: "figma-project";
  projectName: string;
  projectKey?: string;
}

// :Channel — Slack channels.
export interface ChannelNode extends BaseNode {
  domain: "channel";
  channelName: string;
  isPrivate?: boolean;
  topic?: string;
  channelType?: string;
}

// :Repo — code repositories.
export interface RepoNode extends BaseNode {
  domain: "repo";
  repoName: string;
  description?: string;
  defaultBranch?: string;
  webUrl?: string;
}

// Catch-all for any label the wayfinder has no first-class mapper for.
// `primaryLabel` carries the raw Neo4j label so the UI can distinguish
// between different unknown types (e.g. two forthcoming labels render
// with different hash-derived colors instead of collapsing to one).
export interface UnknownNode extends BaseNode {
  domain: "unknown";
  primaryLabel: string;
  allLabels: string[];
  displayValue?: string;   // best-guess display string picked from props
  rawProperties: Record<string, unknown>;
}

export type GraphNode =
  | PersonNode
  | OrganizationNode
  | MemoryLikeNode
  | TaskNode
  | MessageNode
  | DocumentNode
  | MeetingNode
  | IssueNode
  | MergeRequestNode
  | CommitNode
  | ProjectNode
  | JiraProjectNode
  | ConfluenceSpaceNode
  | FigmaTeamNode
  | FigmaProjectNode
  | ChannelNode
  | RepoNode
  | UnknownNode;

// Relationship kinds present in neocortex, plus generic fallbacks.
export type EdgeKind =
  | "authored_by"
  | "sent_to"
  | "cc_to"
  | "has_attachment"
  | "in_channel"
  | "in_repo"
  | "in_jira_project"
  | "in_confluence_space"
  | "in_figma_project"
  | "in_figma_team"
  | "merges_into"
  | "committed_to"
  | "scoped_to"
  | "assigned_to"
  | "reported_by"
  | "reviewed_by"
  | "parent_of"
  | "child_of"
  | "last_edited_by"
  | "evidenced_by"
  | "derived_from"
  | "supersedes"
  | "linked_to"
  | "produced"
  | "part_of"
  | "resolves_to"
  | "depends_on"
  | "references"
  | "mentions"
  | "about"
  | "relates_to"
  | "worked_on"
  | "works_at"
  | "interacts_with"
  | "participated_in"
  | "co_retrieved_with"
  | "led_to_capture"
  | "has_email"
  | "referenced";

export interface GraphEdge {
  id: string;
  source: string;     // node id
  target: string;     // node id
  kind: EdgeKind;
  label?: string;
  directed?: boolean;
  backend?: BackendReference;
  metadata?: Record<string, unknown>;
  visual?: {
    weight?: number;
    strength?: number;
    colorToken?: string;
    emphasis?: "normal" | "muted" | "strong";
  };
}

// A "cloud" is a named subgraph grouping related nodes.
export interface GraphCloud {
  id: string;
  label: string;
  domain: NodeDomain | "mixed";
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphSceneData {
  id: string;
  label: string;
  generatedAt: string;
  graphs: GraphCloud[];
}

export interface VectorTuple {
  x: number;
  y: number;
  z: number;
}

export type Selection =
  | { type: "node"; graphId: string; node: GraphNode }
  | { type: "edge"; graphId: string; edge: GraphEdge }
  | { type: "nodes"; nodes: GraphNode[] }
  | null;

// Neocortex has no read-write mutation surface wired into this UI yet,
// so no actions are exposed. Kept as an (empty) type for future
// expansion — action wiring is retained but returns [] for all nodes.
export type ActionId = never;

export interface NodeAction {
  id: ActionId;
  label: string;
  nodeId: string;
  domain: NodeDomain;
}
