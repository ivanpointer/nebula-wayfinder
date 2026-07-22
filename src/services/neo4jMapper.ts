/**
 * Maps raw Neo4j record properties to nebula-wayfinder domain types.
 *
 * Mapping is intentionally lenient: missing or unexpected properties from
 * Neo4j produce safe fallbacks rather than hard errors, so new neocortex
 * node types degrade gracefully before a proper mapping is added here.
 */

import type {
  GraphNode,
  GraphEdge,
  PersonNode,
  OrganizationNode,
  MemoryLikeNode,
  TaskNode,
  MessageNode,
  DocumentNode,
  MeetingNode,
  IssueNode,
  MergeRequestNode,
  CommitNode,
  ProjectNode,
  JiraProjectNode,
  ConfluenceSpaceNode,
  FigmaTeamNode,
  FigmaProjectNode,
  ChannelNode,
  RepoNode,
  UnknownNode,
  GraphNodeStatus,
  Priority,
  EdgeKind,
  BackendReference,
} from "../domain/types";
import { toIsoString, toNumber } from "./neo4jClient";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Props = Record<string, unknown>;

function backendRef(elementId: string, labels: string[]): BackendReference {
  return { store: "neo4j", elementId, labels };
}

function str(value: unknown): string | undefined {
  if (value == null) return undefined;
  return String(value);
}

function strList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((v) => String(v));
}

function collectHandles(props: Props): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const key of Object.keys(props)) {
    if (key.startsWith("handle_") && props[key] != null) {
      out[key.slice("handle_".length)] = String(props[key]);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function truncateContent(value: unknown, limit = 120): string {
  const s = String(value ?? "");
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
}

function normalizePriority(value: unknown): Priority | undefined {
  const v = str(value)?.toLowerCase();
  if (v === "urgent" || v === "high" || v === "medium" || v === "low") return v;
  return undefined;
}

function taskStatusToGraphStatus(taskStatus: string | undefined): GraphNodeStatus {
  switch (taskStatus) {
    case "open": return "active";
    case "in_progress": return "active";
    case "waiting": return "waiting";
    case "done":
    case "closed": return "complete";
    case "canceled":
    case "dismissed": return "dismissed";
    default: return "idle";
  }
}

function issueStatusToGraphStatus(status: string | undefined): GraphNodeStatus {
  if (!status) return "idle";
  const lower = status.toLowerCase();
  if (lower === "done" || lower === "closed" || lower === "resolved") return "complete";
  if (lower === "in progress" || lower === "in_progress") return "active";
  if (lower.includes("block")) return "blocked";
  return "idle";
}

function mrStateToGraphStatus(state: string | undefined): GraphNodeStatus {
  if (!state) return "idle";
  const lower = state.toLowerCase();
  if (lower === "merged" || lower === "closed") return "complete";
  if (lower === "opened" || lower === "reopened") return "active";
  return "idle";
}

function memoryStatusToGraphStatus(status: string | undefined): GraphNodeStatus {
  if (!status) return "idle";
  if (status === "active" || status === "open") return "idle";
  if (status === "superseded" || status === "closed") return "dismissed";
  return "idle";
}

// ---------------------------------------------------------------------------
// Node mappers
// ---------------------------------------------------------------------------

export function mapPersonNode(props: Props, elementId: string): PersonNode {
  const displayName = str(props.display_name)
    ?? str(props.primary_email)
    ?? str(props.email)
    ?? "Unknown person";
  return {
    id: String(props.identity_key ?? elementId),
    domain: "person",
    label: displayName,
    displayName,
    primaryEmail: str(props.primary_email) ?? str(props.email),
    kind: str(props.kind),
    isSelf: typeof props.is_self === "boolean" ? props.is_self : undefined,
    handles: collectHandles(props),
    status: "idle",
    source: {
      system: str(props.source) ?? "neocortex",
      externalId: String(props.identity_key ?? elementId),
    },
    backend: backendRef(elementId, ["Person"]),
  };
}

export function mapOrganizationNode(props: Props, elementId: string): OrganizationNode {
  const orgName = str(props.name) ?? str(props.domain) ?? "Unknown org";
  return {
    id: String(props.domain ?? elementId),
    domain: "organization",
    label: orgName,
    orgName,
    domain_name: str(props.domain),
    kind: str(props.kind),
    status: "idle",
    source: {
      system: str(props.source) ?? "neocortex",
      externalId: String(props.domain ?? elementId),
    },
    backend: backendRef(elementId, ["Organization"]),
  };
}

function mapMemoryLikeNode(
  domain: MemoryLikeNode["domain"],
  labelCap: string,
  props: Props,
  elementId: string,
): MemoryLikeNode {
  const content = String(props.content ?? "");
  return {
    id: String(props.id ?? elementId),
    domain,
    label: truncateContent(content, 80) || labelCap,
    content,
    kindLabel: str(props.kind_label),
    signalType: str(props.signal_type),
    reconciliationStatus: str(props.reconciliation_status),
    activityStatus: str(props.activity_status),
    status: memoryStatusToGraphStatus(str(props.status)),
    source: {
      system: str(props.source) ?? "neocortex",
      externalId: String(props.id ?? elementId),
    },
    backend: backendRef(elementId, [labelCap]),
  };
}

export function mapTaskNode(props: Props, elementId: string): TaskNode {
  const title = str(props.title) ?? "Untitled task";
  const taskStatus = str(props.status);
  return {
    id: String(props.id ?? elementId),
    domain: "task",
    label: title,
    title,
    details: str(props.details),
    priority: normalizePriority(props.priority),
    taskStatus,
    assignee: str(props.assignee),
    origin: str(props.origin),
    dueAt: toIsoString(props.due_at),
    notBefore: toIsoString(props.not_before),
    confidence: typeof props.confidence === "number" ? props.confidence : toNumber(props.confidence),
    activityStatus: str(props.activity_status),
    status: taskStatusToGraphStatus(taskStatus),
    source: {
      system: str(props.source) ?? "neocortex",
      externalId: String(props.id ?? elementId),
    },
    backend: backendRef(elementId, ["Task"]),
  };
}

export function mapMessageNode(props: Props, elementId: string): MessageNode {
  const subject = str(props.subject);
  const content = str(props.content);
  const label = subject ?? (content ? truncateContent(content, 80) : "(message)");
  return {
    id: String(props.message_key ?? elementId),
    domain: "message",
    label,
    subject,
    content,
    fromEmail: str(props.from_email),
    timestamp: toIsoString(props.timestamp),
    threadId: str(props.thread_id),
    channelName: str(props.channel_name),
    labels: strList(props.labels),
    status: "idle",
    source: {
      system: str(props.source) ?? "neocortex",
      externalId: String(props.message_key ?? elementId),
    },
    backend: backendRef(elementId, ["Message"]),
  };
}

export function mapDocumentNode(props: Props, elementId: string): DocumentNode {
  const title = str(props.title) ?? "(untitled document)";
  return {
    id: String(props.document_id ?? elementId),
    domain: "document",
    label: title,
    title,
    webUrl: str(props.web_url),
    kind: str(props.kind),
    spaceKey: str(props.space_key),
    lastModified: toIsoString(props.last_modified),
    status: "idle",
    source: {
      system: str(props.source) ?? "neocortex",
      externalId: String(props.document_id ?? elementId),
      url: str(props.web_url),
    },
    backend: backendRef(elementId, ["Document"]),
  };
}

export function mapMeetingNode(props: Props, elementId: string): MeetingNode {
  const topic = str(props.topic) ?? "(meeting)";
  return {
    id: String(props.meeting_id ?? elementId),
    domain: "meeting",
    label: topic,
    topic,
    startTime: toIsoString(props.start_time),
    durationSec: toNumber(props.duration_sec),
    shareUrl: str(props.share_url),
    status: "idle",
    source: {
      system: str(props.source) ?? "zoom",
      externalId: String(props.meeting_id ?? elementId),
      url: str(props.share_url),
    },
    backend: backendRef(elementId, ["Meeting"]),
  };
}

export function mapIssueNode(props: Props, elementId: string): IssueNode {
  const key = String(props.issue_key ?? elementId);
  const summary = str(props.summary) ?? str(props.title) ?? "Untitled issue";
  const issueStatus = str(props.status);
  return {
    id: `issue:${key}`,
    domain: "issue",
    label: `${key}: ${summary}`,
    key,
    summary,
    issueType: str(props.issue_type),
    issueStatus,
    priority: str(props.priority),
    labels: strList(props.labels),
    projectKey: str(props.project_key),
    webUrl: str(props.web_url),
    updatedAt: toIsoString(props.updated_at),
    status: issueStatusToGraphStatus(issueStatus),
    source: {
      system: str(props.source) ?? "neocortex",
      externalId: key,
      url: str(props.web_url),
    },
    backend: backendRef(elementId, ["Issue"]),
  };
}

export function mapMergeRequestNode(props: Props, elementId: string): MergeRequestNode {
  const key = String(props.mr_key ?? elementId);
  const title = str(props.title) ?? "Untitled MR";
  const state = str(props.state);
  return {
    id: `mr:${key}`,
    domain: "merge-request",
    label: `${key}: ${title}`,
    key,
    title,
    state,
    sourceBranch: str(props.source_branch),
    targetBranch: str(props.target_branch),
    projectPath: str(props.project_path),
    webUrl: str(props.web_url),
    labels: strList(props.labels),
    status: mrStateToGraphStatus(state),
    source: {
      system: str(props.source) ?? "gitlab",
      externalId: key,
      url: str(props.web_url),
    },
    backend: backendRef(elementId, ["MergeRequest"]),
  };
}

export function mapCommitNode(props: Props, elementId: string): CommitNode {
  const shortSha = str(props.short_sha) ?? String(props.commit_sha ?? elementId).slice(0, 8);
  return {
    id: String(props.commit_key ?? elementId),
    domain: "commit",
    label: shortSha,
    shortSha,
    content: str(props.content),
    projectPath: str(props.project_path),
    webUrl: str(props.web_url),
    timestamp: toIsoString(props.timestamp),
    status: "idle",
    source: {
      system: str(props.source) ?? "gitlab",
      externalId: String(props.commit_key ?? elementId),
      url: str(props.web_url),
    },
    backend: backendRef(elementId, ["Commit"]),
  };
}

export function mapProjectNode(props: Props, elementId: string): ProjectNode {
  const projectName = str(props.name) ?? str(props.project_key) ?? "Unknown project";
  return {
    id: String(props.project_key ?? elementId),
    domain: "project",
    label: projectName,
    projectName,
    projectKey: str(props.project_key),
    status: "active",
    source: {
      system: str(props.source) ?? "neocortex",
      externalId: String(props.project_key ?? elementId),
    },
    backend: backendRef(elementId, ["Project"]),
  };
}

export function mapJiraProjectNode(props: Props, elementId: string): JiraProjectNode {
  const projectName = str(props.name) ?? str(props.jira_project_key) ?? "Jira project";
  return {
    id: String(props.project_key ?? props.jira_project_key ?? elementId),
    domain: "jira-project",
    label: projectName,
    projectName,
    jiraProjectKey: str(props.jira_project_key),
    description: str(props.description),
    status: "idle",
    source: {
      system: "jira",
      externalId: String(props.jira_project_key ?? props.project_key ?? elementId),
    },
    backend: backendRef(elementId, ["JiraProject"]),
  };
}

export function mapConfluenceSpaceNode(props: Props, elementId: string): ConfluenceSpaceNode {
  const spaceName = str(props.name) ?? str(props.space_key) ?? "Confluence space";
  return {
    id: String(props.space_key ?? props.project_key ?? elementId),
    domain: "confluence-space",
    label: spaceName,
    spaceName,
    spaceKey: str(props.space_key),
    description: str(props.description),
    status: "idle",
    source: {
      system: "confluence",
      externalId: String(props.space_key ?? elementId),
    },
    backend: backendRef(elementId, ["ConfluenceSpace"]),
  };
}

export function mapFigmaTeamNode(props: Props, elementId: string): FigmaTeamNode {
  const teamName = str(props.name) ?? "Figma team";
  return {
    id: String(props.team_key ?? elementId),
    domain: "figma-team",
    label: teamName,
    teamName,
    teamKey: str(props.team_key),
    status: "idle",
    source: {
      system: "figma",
      externalId: String(props.team_key ?? elementId),
    },
    backend: backendRef(elementId, ["FigmaTeam"]),
  };
}

export function mapFigmaProjectNode(props: Props, elementId: string): FigmaProjectNode {
  const projectName = str(props.name) ?? "Figma project";
  return {
    id: String(props.project_key ?? elementId),
    domain: "figma-project",
    label: projectName,
    projectName,
    projectKey: str(props.project_key),
    status: "idle",
    source: {
      system: "figma",
      externalId: String(props.project_key ?? elementId),
    },
    backend: backendRef(elementId, ["FigmaProject"]),
  };
}

export function mapChannelNode(props: Props, elementId: string): ChannelNode {
  const channelName = str(props.name) ?? "channel";
  const isPrivate = typeof props.is_private === "boolean" ? props.is_private : undefined;
  return {
    id: String(props.channel_key ?? elementId),
    domain: "channel",
    label: (isPrivate ? "🔒 " : "#") + channelName,
    channelName,
    isPrivate,
    topic: str(props.topic),
    channelType: str(props.channel_type),
    status: "idle",
    source: {
      system: "slack",
      externalId: String(props.channel_key ?? props.channel_id ?? elementId),
    },
    backend: backendRef(elementId, ["Channel"]),
  };
}

export function mapRepoNode(props: Props, elementId: string): RepoNode {
  const repoName = str(props.name) ?? "repo";
  return {
    id: String(props.repo_key ?? elementId),
    domain: "repo",
    label: repoName,
    repoName,
    description: str(props.description),
    defaultBranch: str(props.default_branch),
    webUrl: str(props.web_url),
    status: "idle",
    source: {
      system: str(props.source) ?? "gitlab",
      externalId: String(props.repo_key ?? elementId),
      url: str(props.web_url),
    },
    backend: backendRef(elementId, ["Repo"]),
  };
}

// Catch-all mapper — surfaces any label the wayfinder hasn't been taught
// yet. Neocortex's ontology expands over time (schema-agent proposals +
// phase splits) and we want new labels visible in the graph as soon as
// they appear in Neo4j, even before a first-class mapping is added.
export function mapUnknownNode(
  labels: string[],
  props: Props,
  elementId: string,
): UnknownNode {
  const primaryLabel = labels[0] ?? "Node";
  // Pick a reasonable display string from whatever properties the node
  // happens to carry. This is intentionally best-effort — a first-class
  // mapper should be added when a novel label recurs.
  const displayCandidates = [
    "title", "name", "subject", "summary", "topic",
    "display_name", "content", "id", "key",
  ];
  let displayValue: string | undefined;
  for (const key of displayCandidates) {
    const v = props[key];
    if (v != null && String(v).length > 0) {
      displayValue = truncateContent(v, 80);
      break;
    }
  }
  const label = displayValue ?? primaryLabel;
  return {
    id: String(props.id ?? props.key ?? elementId),
    domain: "unknown",
    label,
    primaryLabel,
    allLabels: labels,
    displayValue,
    rawProperties: props,
    status: "idle",
    source: {
      system: str(props.source) ?? "neocortex",
      externalId: String(props.id ?? props.key ?? elementId),
    },
    backend: backendRef(elementId, labels),
  };
}

// ---------------------------------------------------------------------------
// Edge mapper
// ---------------------------------------------------------------------------

// Relationship type from Neo4j (uppercase, underscored) → EdgeKind.
// Every value here MUST correspond to an EdgeKind literal in domain/types.ts.
const REL_TYPE_MAP: Record<string, EdgeKind> = {
  AUTHORED_BY: "authored_by",
  SENT_TO: "sent_to",
  CC_TO: "cc_to",
  HAS_ATTACHMENT: "has_attachment",
  IN_CHANNEL: "in_channel",
  IN_REPO: "in_repo",
  IN_JIRA_PROJECT: "in_jira_project",
  IN_CONFLUENCE_SPACE: "in_confluence_space",
  IN_FIGMA_PROJECT: "in_figma_project",
  IN_FIGMA_TEAM: "in_figma_team",
  MERGES_INTO: "merges_into",
  COMMITTED_TO: "committed_to",
  SCOPED_TO: "scoped_to",
  ASSIGNED_TO: "assigned_to",
  REPORTED_BY: "reported_by",
  REVIEWED_BY: "reviewed_by",
  PARENT_OF: "parent_of",
  CHILD_OF: "child_of",
  LAST_EDITED_BY: "last_edited_by",
  EVIDENCED_BY: "evidenced_by",
  DERIVED_FROM: "derived_from",
  SUPERSEDES: "supersedes",
  LINKED_TO: "linked_to",
  PART_OF: "part_of",
  RESOLVES_TO: "resolves_to",
  DEPENDS_ON: "depends_on",
  REFERENCES: "references",
  MENTIONS: "mentions",
  ABOUT: "about",
  RELATES_TO: "relates_to",
  WORKED_ON: "worked_on",
  WORKS_AT: "works_at",
  INTERACTS_WITH: "interacts_with",
  PARTICIPATED_IN: "participated_in",
  CO_RETRIEVED_WITH: "co_retrieved_with",
  LED_TO_CAPTURE: "led_to_capture",
  PRODUCED: "produced",
  HAS_EMAIL: "has_email",
};

const REL_VISUALS: Partial<Record<EdgeKind, GraphEdge["visual"]>> = {
  parent_of: { colorToken: "hierarchy", weight: 1.15, emphasis: "strong" },
  child_of: { colorToken: "hierarchy", weight: 0.95 },
  in_jira_project: { colorToken: "container", weight: 0.9 },
  in_confluence_space: { colorToken: "container", weight: 0.9 },
  in_figma_project: { colorToken: "container", weight: 0.9 },
  in_figma_team: { colorToken: "container", weight: 0.9 },
  in_channel: { colorToken: "container", weight: 0.9 },
  in_repo: { colorToken: "container", weight: 0.9 },
  merges_into: { colorToken: "work", weight: 1.05, emphasis: "strong" },
  committed_to: { colorToken: "work", weight: 0.95 },
  authored_by: { colorToken: "person", weight: 0.85 },
  assigned_to: { colorToken: "person", weight: 1.0, emphasis: "strong" },
  reported_by: { colorToken: "person", weight: 0.9 },
  reviewed_by: { colorToken: "person", weight: 0.9 },
  scoped_to: { colorToken: "container", weight: 1.1, emphasis: "strong" },
  evidenced_by: { colorToken: "memory", weight: 1.0 },
  derived_from: { colorToken: "memory", weight: 0.95 },
  supersedes: { colorToken: "memory", weight: 1.2, emphasis: "strong" },
  linked_to: { colorToken: "memory", weight: 0.82 },
  co_retrieved_with: { colorToken: "memory", weight: 0.7, emphasis: "muted" },
  led_to_capture: { colorToken: "memory", weight: 0.9 },
};

export function mapEdge(
  relType: string,
  relElementId: string,
  sourceNodeId: string,
  targetNodeId: string,
  props: Props = {},
): GraphEdge {
  const kind: EdgeKind = REL_TYPE_MAP[relType] ?? "relates_to";
  return {
    id: relElementId,
    source: sourceNodeId,
    target: targetNodeId,
    kind,
    label: relType.toLowerCase().replace(/_/g, " "),
    directed: true,
    backend: { store: "neo4j", elementId: relElementId, relationshipType: relType },
    metadata: props as Record<string, unknown>,
    visual: REL_VISUALS[kind],
  };
}

// ---------------------------------------------------------------------------
// Generic dispatch — picks the right mapper from the node's labels array.
// The first-match order matters: the more specific subtypes (JiraProject,
// ConfluenceSpace, MergeRequest, Commit, Meeting, Retro) must be checked
// before the label they used to be lumped under (Project, Issue, Message).
// ---------------------------------------------------------------------------

// Labels that neocortex writes but the wayfinder intentionally skips —
// they're infrastructure (schema migrations), content-addressed binaries
// with no visual meaning on their own, or singleton markers that would
// clutter the scene.
export const HIDDEN_LABELS: ReadonlySet<string> = new Set([
  "_SchemaMigration",
  "Blob",
  "Chunk",
  "Scope",
  "EmailAddress",
  "Reference",
  "System",
]);

// Labels the wayfinder has first-class mappers for. Anything with any
// other label goes through mapUnknownNode.
export const KNOWN_LABELS: ReadonlySet<string> = new Set([
  "Person", "Organization",
  "Memory", "Decision", "Spec", "Preference", "Task", "Retro",
  "Message", "Document", "Meeting",
  "Issue", "MergeRequest", "Commit",
  "Project", "JiraProject", "ConfluenceSpace",
  "FigmaTeam", "FigmaProject", "Channel", "Repo",
]);

export function mapNode(labels: string[], props: Props, elementId: string): GraphNode | null {
  // Explicit skip list — never render internal / infrastructural nodes.
  if (labels.some((l) => HIDDEN_LABELS.has(l))) return null;

  if (labels.includes("Person")) return mapPersonNode(props, elementId);
  if (labels.includes("Organization")) return mapOrganizationNode(props, elementId);

  if (labels.includes("Retro")) return mapMemoryLikeNode("retro", "Retro", props, elementId);
  if (labels.includes("Decision")) return mapMemoryLikeNode("decision", "Decision", props, elementId);
  if (labels.includes("Spec")) return mapMemoryLikeNode("spec", "Spec", props, elementId);
  if (labels.includes("Preference")) return mapMemoryLikeNode("preference", "Preference", props, elementId);
  if (labels.includes("Memory")) return mapMemoryLikeNode("memory", "Memory", props, elementId);

  if (labels.includes("Task")) return mapTaskNode(props, elementId);

  if (labels.includes("Meeting")) return mapMeetingNode(props, elementId);
  if (labels.includes("MergeRequest")) return mapMergeRequestNode(props, elementId);
  if (labels.includes("Commit")) return mapCommitNode(props, elementId);
  if (labels.includes("Issue")) return mapIssueNode(props, elementId);
  if (labels.includes("Message")) return mapMessageNode(props, elementId);
  if (labels.includes("Document")) return mapDocumentNode(props, elementId);

  if (labels.includes("JiraProject")) return mapJiraProjectNode(props, elementId);
  if (labels.includes("ConfluenceSpace")) return mapConfluenceSpaceNode(props, elementId);
  if (labels.includes("FigmaProject")) return mapFigmaProjectNode(props, elementId);
  if (labels.includes("FigmaTeam")) return mapFigmaTeamNode(props, elementId);
  if (labels.includes("Channel")) return mapChannelNode(props, elementId);
  if (labels.includes("Repo")) return mapRepoNode(props, elementId);
  if (labels.includes("Project")) return mapProjectNode(props, elementId);

  // Unknown label — surface it so the frontend doesn't hide new
  // neocortex ontology growth. A first-class mapper can be added later.
  return mapUnknownNode(labels, props, elementId);
}
