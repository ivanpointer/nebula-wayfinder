/**
 * Maps raw Neo4j record properties to nebula-wayfinder domain types.
 *
 * Mapping is intentionally lenient: missing or unexpected properties from
 * Neo4j produce safe fallbacks rather than hard errors, so new unibrain
 * node types degrade gracefully before a proper mapping is added.
 */

import type {
  GraphNode,
  GraphEdge,
  TodoNode,
  EmailNode,
  PersonNode,
  OrganizationNode,
  ActionProposalNode,
  GraphNodeStatus,
  Priority,
  EdgeKind,
  BackendReference,
} from "../domain/types";
import { toIsoString } from "./neo4jClient";

// ---------------------------------------------------------------------------
// Status and priority normalization
// ---------------------------------------------------------------------------

function todoStatusToGraphStatus(
  todoStatus: string | undefined,
  reviewStatus: string | undefined,
): GraphNodeStatus {
  if (reviewStatus === "draft") return "draft";
  switch (todoStatus) {
    case "open": return "active";
    case "in_progress": return "active";
    case "waiting": return "waiting";
    case "done": return "complete";
    case "canceled": return "dismissed";
    default: return "idle";
  }
}

function normalizePriority(value: string | undefined): Priority {
  switch (value) {
    case "urgent": return "urgent";
    case "high": return "high";
    case "medium": return "medium";
    case "low": return "low";
    default: return "medium";
  }
}

// ---------------------------------------------------------------------------
// Node mappers — one per unibrain label
// ---------------------------------------------------------------------------

// Props type represents a plain JS object of raw Neo4j node properties.
type Props = Record<string, unknown>;

function backendRef(elementId: string, labels: string[]): BackendReference {
  return { store: "neo4j", elementId, labels };
}

export function mapTodoNode(props: Props, elementId: string): TodoNode {
  const todoStatus = String(props.status ?? "open") as TodoNode["todoStatus"];
  const reviewStatus = String(props.review_status ?? "");
  return {
    id: String(props.todo_key ?? props.id ?? elementId),
    domain: "todo",
    label: String(props.title ?? "Untitled todo"),
    title: String(props.title ?? "Untitled todo"),
    details: props.details != null ? String(props.details) : undefined,
    dueDate: toIsoString(props.due_at),
    priority: normalizePriority(props.priority as string | undefined),
    todoStatus,
    reviewStatus,
    status: todoStatusToGraphStatus(todoStatus, reviewStatus),
    evidence: props.evidence != null ? String(props.evidence) : undefined,
    confidence: typeof props.confidence === "number" ? props.confidence : undefined,
    source: { system: "unibrain", externalId: String(props.todo_key ?? elementId) },
    backend: backendRef(elementId, ["Todo"]),
    metadata: {
      source_item_key: props.source_item_key,
      last_operation: props.last_operation,
    },
  };
}

export function mapEmailNode(props: Props, elementId: string): EmailNode {
  // unibrain doesn't track a read/unread flag yet; treat all emails as unread
  // so they render with the "unread" visual treatment until read-tracking lands.
  const unread = true;
  return {
    id: String(props.message_key ?? props.id ?? elementId),
    domain: "email",
    label: String(props.subject ?? "(no subject)"),
    sender: String(props.from_email ?? "unknown"),
    senderName: props.from_name != null ? String(props.from_name) : undefined,
    subject: String(props.subject ?? "(no subject)"),
    timestamp: toIsoString(props.received_at ?? props.sent_at) ?? new Date().toISOString(),
    unread,
    threadId: props.thread_id != null ? String(props.thread_id) : undefined,
    status: "unread",
    source: { system: String(props.source ?? "gmail"), externalId: String(props.message_key ?? elementId) },
    backend: backendRef(elementId, ["EmailMessage", "RawIntake"]),
    metadata: {
      source_account: props.source_account,
      ingest_count: props.ingest_count,
    },
  };
}

export function mapPersonNode(props: Props, elementId: string): PersonNode {
  const displayName = String(props.display_name ?? props.primary_email ?? "Unknown person");
  return {
    id: String(props.identity_key ?? elementId),
    domain: "person",
    label: displayName,
    displayName,
    primaryEmail: props.primary_email != null ? String(props.primary_email) : undefined,
    status: "idle",
    source: { system: "unibrain", externalId: String(props.identity_key ?? elementId) },
    backend: backendRef(elementId, ["Person"]),
  };
}

export function mapOrganizationNode(props: Props, elementId: string): OrganizationNode {
  const orgName = String(props.name ?? props.domain ?? "Unknown org");
  return {
    id: String(props.id ?? props.domain ?? elementId),
    domain: "organization",
    label: orgName,
    orgName,
    domain_name: props.domain != null ? String(props.domain) : undefined,
    status: "idle",
    source: { system: "unibrain", externalId: String(props.id ?? props.domain ?? elementId) },
    backend: backendRef(elementId, ["Organization"]),
  };
}

export function mapActionProposalNode(props: Props, elementId: string): ActionProposalNode {
  return {
    id: String(props.id ?? elementId),
    domain: "action-proposal",
    label: String(props.title ?? props.action_type ?? "Proposal"),
    proposalTitle: String(props.title ?? props.action_type ?? "Proposal"),
    riskLevel: props.risk_level != null ? String(props.risk_level) : undefined,
    proposalStatus: String(props.status ?? "draft"),
    confidence: typeof props.confidence === "number" ? props.confidence : undefined,
    status: "draft",
    source: { system: "unibrain", externalId: String(props.id ?? elementId) },
    backend: backendRef(elementId, ["ActionProposal"]),
    metadata: { evidence: props.evidence },
  };
}

// ---------------------------------------------------------------------------
// Edge mapper
// ---------------------------------------------------------------------------

// Relationship type from Neo4j (uppercase, underscored) → EdgeKind
const REL_TYPE_MAP: Record<string, EdgeKind> = {
  SENT_BY: "sent_by",
  SENT_TO: "sent_to",
  CC_TO: "cc_to",
  HAS_TODO: "has_todo",
  PRODUCED: "produced",
  EVIDENCED_BY: "evidenced_by",
  ANALYZED_BY: "analyzed_by",
  DERIVED_FROM: "derived_from",
  HAS_EMAIL: "has_email",
  WORKS_AT: "works_at",
  RELATED_TO: "related_to",
  REFERENCED: "referenced",
};

export function mapEdge(
  relType: string,
  relElementId: string,
  sourceNodeId: string,
  targetNodeId: string,
  props: Props = {},
): GraphEdge {
  const kind: EdgeKind = REL_TYPE_MAP[relType] ?? "related_to";
  return {
    id: relElementId,
    source: sourceNodeId,
    target: targetNodeId,
    kind,
    label: relType.toLowerCase().replace(/_/g, " "),
    directed: true,
    backend: { store: "neo4j", elementId: relElementId, relationshipType: relType },
    metadata: props as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Generic dispatch — picks the right mapper from the node's labels array
// ---------------------------------------------------------------------------

export function mapNode(labels: string[], props: Props, elementId: string): GraphNode | null {
  if (labels.includes("Todo")) return mapTodoNode(props, elementId);
  if (labels.includes("EmailMessage")) return mapEmailNode(props, elementId);
  if (labels.includes("Person")) return mapPersonNode(props, elementId);
  if (labels.includes("Organization")) return mapOrganizationNode(props, elementId);
  if (labels.includes("ActionProposal")) return mapActionProposalNode(props, elementId);
  // Unknown label — skip; new unibrain types will be added here as they land.
  return null;
}
