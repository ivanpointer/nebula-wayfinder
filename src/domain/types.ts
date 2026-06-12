// Node domains map 1-to-1 with the primary Neo4j label used in unibrain.
// This list will grow as unibrain adds new vertex types.
export type NodeDomain =
  | "todo"
  | "email"
  | "person"
  | "organization"
  | "action-proposal";

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

// :Todo — extracted task items (from emails, etc.)
export interface TodoNode extends BaseNode {
  domain: "todo";
  title: string;
  details?: string;
  dueDate?: string;
  priority: Priority;
  todoStatus: "open" | "in_progress" | "waiting" | "done" | "canceled";
  reviewStatus: string;   // e.g. "draft"
  evidence?: string;
  confidence?: number;
}

// :EmailMessage :RawIntake — normalized inbound email
export interface EmailNode extends BaseNode {
  domain: "email";
  sender: string;
  senderName?: string;
  subject: string;
  timestamp: string;
  unread: boolean;
  threadId?: string;
}

// :Person — identity record inferred from email senders/recipients
export interface PersonNode extends BaseNode {
  domain: "person";
  displayName: string;
  primaryEmail?: string;
  organization?: string;
}

// :Organization — inferred from non-public email domains
export interface OrganizationNode extends BaseNode {
  domain: "organization";
  orgName: string;
  domain_name?: string;   // the email domain, e.g. "acme.com"
}

// :ActionProposal — AI-proposed action, draft review state
export interface ActionProposalNode extends BaseNode {
  domain: "action-proposal";
  proposalTitle: string;
  riskLevel?: string;
  proposalStatus: string;
  confidence?: number;
}

export type GraphNode =
  | TodoNode
  | EmailNode
  | PersonNode
  | OrganizationNode
  | ActionProposalNode;

// Relationship kinds present in unibrain, plus generic fallbacks.
export type EdgeKind =
  | "sent_by"
  | "sent_to"
  | "cc_to"
  | "has_todo"
  | "produced"
  | "evidenced_by"
  | "analyzed_by"
  | "derived_from"
  | "has_email"
  | "works_at"
  | "related_to"
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

export type ActionId =
  | "todo.markDone"
  | "todo.dismiss"
  | "todo.priority.low"
  | "todo.priority.medium"
  | "todo.priority.high"
  | "todo.priority.urgent";

export interface NodeAction {
  id: ActionId;
  label: string;
  nodeId: string;
  domain: NodeDomain;
}
