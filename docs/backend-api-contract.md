# Backend API Contract

Nebula Wayfinder should treat Neo4j as the backend graph store, but the browser should consume a product-level API rather than raw Cypher results.

## Core Shape

The API returns `GraphSceneData`: one scene containing multiple graph clouds, domain-specific nodes, and first-class relationship records.

Neo4j maps naturally to this model:

- Neo4j node labels map to `domain` plus optional `backend.labels`.
- Neo4j relationship types map to `edge.kind` plus optional `backend.relationshipType`.
- Neo4j node and relationship properties map to typed domain fields plus optional `metadata`.
- Neo4j `elementId()` maps to optional `backend.elementId`.

The frontend should use stable product ids like `task-write-spec` for rendering and interaction state. Neo4j ids remain backend references only.

## Read API

Recommended first endpoint:

```http
GET /api/graph-scenes/home
```

Response:

```ts
interface GraphSceneData {
  id: string;
  label: string;
  generatedAt: string;
  graphs: GraphCloud[];
}
```

Query parameters can be added without changing the scene shape:

- `domains=task,email,agent-session`
- `limit=300`
- `depth=1`
- `focusNodeId=...`
- `includeDismissed=false`

## Relationship Semantics

Edges are first-class knowledge graph records, not just rendering instructions.

```ts
interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label?: string;
  directed?: boolean;
  backend?: BackendReference;
  metadata?: Record<string, unknown>;
  visual?: GraphEdgeVisualHints;
}
```

Neo4j relationships are physically directed, but the API can set `directed: false` for symmetric concepts like `related_to`. The UI should render arrows or flow indicators only when `directed` is true.

Relationship properties should be preserved in `metadata` when they matter to inspection, provenance, confidence, timestamps, source-system ids, or future filtering.

Jira issue hierarchy is represented as explicit relationships rather than LLM-inferred adjacency:

- `PARENT_OF` / `CHILD_OF` connect parent tasks to subtasks.
- `REPRESENTS_PROJECT`, `IN_EPIC`, `IN_JIRA_PROJECT`, and `HAS_JIRA_ISSUE` connect Jira epics/projects to the reusable `Project` concept.
- `LINKED_TO` preserves Jira linked issues, with link direction/type retained in edge metadata.

## Actions API

The UI should ask the backend which actions are available for a selected node. The backend decides based on domain, permissions, current state, and source integration state.

```http
GET /api/nodes/:nodeId/actions
POST /api/actions
```

Action execution request:

```ts
interface ExecuteActionRequest {
  actionId: string;
  nodeId: string;
  params?: Record<string, unknown>;
}
```

Action execution response:

```ts
interface ExecuteActionResponse {
  scenePatch?: GraphScenePatch;
  refreshedNode?: GraphNode;
  refreshedEdges?: GraphEdge[];
}
```

V1 can continue using mocked local actions, but the browser should keep the same action boundary so task-manager, email, messaging, contacts, and AI-agent integrations can move behind the backend later.

## Layout API

Node positions are user interaction state, not source-of-truth knowledge facts.

Recommended endpoint:

```http
PATCH /api/graph-scenes/:sceneId/layout
```

Payload:

```ts
interface LayoutPatch {
  positions: Array<{
    nodeId: string;
    position: { x: number; y: number; z: number };
  }>;
}
```

Persisting positions separately lets Neo4j keep semantic graph data clean while still allowing user-specific layouts.

## Frontend Rules

- Do not expose Cypher or Neo4j query details in the browser.
- Keep domain schemas separate for tasks, contacts, emails, messages, and AI-agent sessions.
- Keep edge metadata optional but inspectable.
- Preserve relationship direction independently from visual styling.
- Keep drag/layout changes separate from domain actions like complete, dismiss, or change priority.
