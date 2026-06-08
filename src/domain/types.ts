export type NodeDomain = "task" | "contact" | "email" | "message" | "agent-session";

export type GraphNodeStatus =
  | "active"
  | "blocked"
  | "complete"
  | "dismissed"
  | "idle"
  | "unread"
  | "waiting";

export type Priority = "low" | "medium" | "high" | "urgent";

export interface SourceReference {
  system: string;
  externalId: string;
  url?: string;
}

export interface BaseNode {
  id: string;
  domain: NodeDomain;
  label: string;
  status: GraphNodeStatus;
  source: SourceReference;
  metadata?: Record<string, unknown>;
  fixedPosition?: VectorTuple;
}

export interface TaskNode extends BaseNode {
  domain: "task";
  title: string;
  dueDate?: string;
  priority: Priority;
  completed: boolean;
  dismissed?: boolean;
  project?: string;
}

export interface ContactNode extends BaseNode {
  domain: "contact";
  name: string;
  organization?: string;
  role?: string;
  communicationRefs: SourceReference[];
}

export interface EmailNode extends BaseNode {
  domain: "email";
  sender: string;
  subject: string;
  timestamp: string;
  unread: boolean;
  followUp: boolean;
  dismissed?: boolean;
}

export interface MessageNode extends BaseNode {
  domain: "message";
  sender: string;
  channel: string;
  thread?: string;
  timestamp: string;
  unread: boolean;
  followUp: boolean;
  dismissed?: boolean;
}

export type AgentSessionStatus = "running" | "paused" | "waiting" | "complete" | "failed";

export interface AgentSessionNode extends BaseNode {
  domain: "agent-session";
  agentName: string;
  runtime: string;
  model: string;
  taskSummary: string;
  sessionStatus: AgentSessionStatus;
  startedAt: string;
  updatedAt: string;
  owner?: string;
  relatedArtifacts: SourceReference[];
}

export type GraphNode = TaskNode | ContactNode | EmailNode | MessageNode | AgentSessionNode;

export type EdgeKind =
  | "assigned_to"
  | "blocked_by"
  | "mentions"
  | "sent_by"
  | "working_on"
  | "produced"
  | "referenced"
  | "follow_up_from"
  | "related_to";

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label?: string;
  directed?: boolean;
  metadata?: Record<string, unknown>;
  visual?: {
    weight?: number;
    strength?: number;
    colorToken?: string;
    emphasis?: "normal" | "muted" | "strong";
  };
}

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
  | null;

export type ActionId =
  | "task.markDone"
  | "task.dismiss"
  | "task.priority.low"
  | "task.priority.medium"
  | "task.priority.high"
  | "task.priority.urgent";

export interface NodeAction {
  id: ActionId;
  label: string;
  nodeId: string;
  domain: NodeDomain;
}
