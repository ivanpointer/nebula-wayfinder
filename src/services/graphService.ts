/**
 * Fetches the live graph scene from the neocortex Neo4j instance
 * (the graph inside the second-brain project).
 *
 * The scene is divided into clouds that group neocortex's primary
 * node types by role: memory-kind knowledge nodes, tasks, content,
 * people, dev-work items, and containers/scopes.
 *
 * Nodes with unmapped labels are silently dropped, so new neocortex
 * types degrade gracefully until a mapper is added in neo4jMapper.ts.
 *
 * Edges are fetched in a second pass; only edges whose both endpoints
 * landed in our node map are kept, which prevents an ever-expanding
 * fetch as new node kinds appear upstream.
 */

import { runQuery } from "./neo4jClient";
import { mapNode, mapEdge, HIDDEN_LABELS, KNOWN_LABELS } from "./neo4jMapper";
import type { GraphSceneData, GraphCloud, GraphNode, GraphEdge } from "../domain/types";

// ---------------------------------------------------------------------------
// Node queries — one per primary label. Limits are conservative because
// neocortex accumulates a lot of low-signal source data (email, chunks)
// and the 3D view saturates well before then.
// ---------------------------------------------------------------------------

const QUERY_MEMORIES = `
MATCH (m:Memory)
WHERE coalesce(m.status, 'active') = 'active'
RETURN elementId(m) AS elementId, labels(m) AS labels, properties(m) AS props
ORDER BY m.updated_at DESC
LIMIT 200
`;

const QUERY_DECISIONS = `
MATCH (d:Decision)
WHERE coalesce(d.status, 'active') = 'active'
RETURN elementId(d) AS elementId, labels(d) AS labels, properties(d) AS props
ORDER BY d.updated_at DESC
LIMIT 100
`;

const QUERY_SPECS = `
MATCH (s:Spec)
WHERE coalesce(s.status, 'active') = 'active'
RETURN elementId(s) AS elementId, labels(s) AS labels, properties(s) AS props
ORDER BY s.updated_at DESC
LIMIT 100
`;

const QUERY_PREFERENCES = `
MATCH (p:Preference)
WHERE coalesce(p.status, 'active') = 'active'
RETURN elementId(p) AS elementId, labels(p) AS labels, properties(p) AS props
ORDER BY p.updated_at DESC
LIMIT 100
`;

// Retros are agent self-assessment records; include triaged/addressed
// too so the UI shows the full loop, not just currently-open items.
const QUERY_RETROS = `
MATCH (r:Retro)
RETURN elementId(r) AS elementId, labels(r) AS labels, properties(r) AS props
ORDER BY r.updated_at DESC
LIMIT 100
`;

// Open tasks — the actionable view.
const QUERY_TASKS = `
MATCH (t:Task)
WHERE coalesce(t.status, 'open') IN ['open', 'in_progress', 'waiting']
RETURN elementId(t) AS elementId, labels(t) AS labels, properties(t) AS props
ORDER BY
  CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
  CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END,
  t.due_at ASC
LIMIT 100
`;

// Recent messages (email/Slack/Jira comments/GitLab notes).
const QUERY_MESSAGES = `
MATCH (m:Message)
RETURN elementId(m) AS elementId, labels(m) AS labels, properties(m) AS props
ORDER BY coalesce(m.timestamp, m.observed_at) DESC
LIMIT 75
`;

const QUERY_DOCUMENTS = `
MATCH (d:Document)
RETURN elementId(d) AS elementId, labels(d) AS labels, properties(d) AS props
ORDER BY coalesce(d.last_modified, d.updated_at, d.observed_at) DESC
LIMIT 100
`;

const QUERY_MEETINGS = `
MATCH (m:Meeting)
RETURN elementId(m) AS elementId, labels(m) AS labels, properties(m) AS props
ORDER BY m.start_time DESC
LIMIT 50
`;

// People that show up somewhere interesting — either authoring content,
// receiving messages, or being explicitly scoped/assigned. Filtering
// out "orphan" people keeps the graph from being drowned in inferred
// email-sender identities.
const QUERY_PEOPLE = `
MATCH (p:Person)
WHERE EXISTS { (:Message)-[:AUTHORED_BY|SENT_TO|CC_TO]-(p) }
   OR EXISTS { (:Document)-[:AUTHORED_BY|LAST_EDITED_BY]->(p) }
   OR EXISTS { (:Task|Issue|MergeRequest)-[:ASSIGNED_TO|REPORTED_BY|REVIEWED_BY|AUTHORED_BY]->(p) }
RETURN elementId(p) AS elementId, labels(p) AS labels, properties(p) AS props
LIMIT 150
`;

const QUERY_ORGS = `
MATCH (o:Organization)
WHERE EXISTS { (:Person)-[:WORKS_AT]->(o) }
   OR EXISTS { (o)-[:SCOPED_TO]->(:Scope) }
RETURN elementId(o) AS elementId, labels(o) AS labels, properties(o) AS props
LIMIT 100
`;

const QUERY_ISSUES = `
MATCH (i:Issue)
RETURN elementId(i) AS elementId, labels(i) AS labels, properties(i) AS props
ORDER BY coalesce(i.updated_at, i.observed_at) DESC
LIMIT 200
`;

const QUERY_MRS = `
MATCH (mr:MergeRequest)
RETURN elementId(mr) AS elementId, labels(mr) AS labels, properties(mr) AS props
ORDER BY coalesce(mr.updated_at, mr.observed_at) DESC
LIMIT 100
`;

const QUERY_COMMITS = `
MATCH (c:Commit)
RETURN elementId(c) AS elementId, labels(c) AS labels, properties(c) AS props
ORDER BY coalesce(c.timestamp, c.observed_at) DESC
LIMIT 100
`;

const QUERY_PROJECTS = `
MATCH (p:Project)
RETURN elementId(p) AS elementId, labels(p) AS labels, properties(p) AS props
LIMIT 100
`;

const QUERY_JIRA_PROJECTS = `
MATCH (jp:JiraProject)
RETURN elementId(jp) AS elementId, labels(jp) AS labels, properties(jp) AS props
LIMIT 50
`;

const QUERY_CONFLUENCE_SPACES = `
MATCH (cs:ConfluenceSpace)
RETURN elementId(cs) AS elementId, labels(cs) AS labels, properties(cs) AS props
LIMIT 50
`;

const QUERY_FIGMA_TEAMS = `
MATCH (ft:FigmaTeam)
RETURN elementId(ft) AS elementId, labels(ft) AS labels, properties(ft) AS props
LIMIT 25
`;

const QUERY_FIGMA_PROJECTS = `
MATCH (fp:FigmaProject)
RETURN elementId(fp) AS elementId, labels(fp) AS labels, properties(fp) AS props
LIMIT 50
`;

const QUERY_CHANNELS = `
MATCH (c:Channel)
RETURN elementId(c) AS elementId, labels(c) AS labels, properties(c) AS props
LIMIT 50
`;

const QUERY_REPOS = `
MATCH (r:Repo)
RETURN elementId(r) AS elementId, labels(r) AS labels, properties(r) AS props
LIMIT 50
`;

// Catch-all for labels the wayfinder doesn't have a first-class mapper for.
// Neocortex adds new labels over time (ontology growth is expected — see
// docs/architecture/ontology.md and the schema-agent proposals) and this
// query surfaces them without a frontend code change. Nodes get rendered
// with a hash-based color derived from their primary label so distinct
// unknown types remain visually distinguishable.
//
// Excludes:
//  - Every label the wayfinder already fetches with a dedicated query
//    (double-fetching would just waste a round-trip; mapNode would still
//    dispatch correctly).
//  - Infrastructure / content-addressed labels that should never render
//    (:Blob, :Chunk, :_SchemaMigration, :Scope, :EmailAddress, :Reference,
//    :System). Kept in sync with HIDDEN_LABELS in neo4jMapper.ts.
function buildUnknownQuery(): string {
  const excluded = [...KNOWN_LABELS, ...HIDDEN_LABELS];
  const notAny = excluded.map((l) => `n:\`${l}\``).join(" OR ");
  return `
MATCH (n)
WHERE NOT (${notAny})
RETURN elementId(n) AS elementId, labels(n) AS labels, properties(n) AS props
LIMIT 200
`;
}
const QUERY_UNKNOWN = buildUnknownQuery();

// ---------------------------------------------------------------------------
// Edge query — only between labels we actually fetch, and only edge types
// neocortex actually writes today (see neocortex/ontology/edges.py).
// ---------------------------------------------------------------------------

// Endpoint filter for the edge query — exclude only the labels the
// wayfinder never renders (infrastructural / content-addressed). This
// leaves unknown-but-rendered labels included, so edges into future
// neocortex node types come through automatically. The JS-side filter
// in fetchEdges still drops any edge whose endpoint didn't land in the
// node map (limits, hidden labels, or other filters kicking in).
function endpointFilter(): string {
  const hidden = [...HIDDEN_LABELS];
  const notA = hidden.map((l) => `a:\`${l}\``).join(" OR ");
  const notB = hidden.map((l) => `b:\`${l}\``).join(" OR ");
  return `NOT (${notA}) AND NOT (${notB})`;
}
const RENDERED_LABELS = endpointFilter();

// Edge query — no rel-type allowlist. Novel edge types (added by future
// neocortex ontology expansions) render with a generic "relates_to" kind
// and their raw relType visible in the inspector, so they show up as
// soon as neocortex writes them. Endpoint labels still gate to what we
// actually fetched — an edge into a Blob or _SchemaMigration wouldn't
// pass because that endpoint won't be in the node map.
const QUERY_EDGES = `
MATCH (a)-[r]->(b)
WHERE ${RENDERED_LABELS}
RETURN
  elementId(r)  AS elementId,
  type(r)       AS relType,
  elementId(a)  AS sourceElementId,
  elementId(b)  AS targetElementId,
  properties(r) AS props
LIMIT 2000
`;

// ---------------------------------------------------------------------------
// Build the scene
// ---------------------------------------------------------------------------

interface FetchedNodes {
  nodeMap: Map<string, GraphNode>;
  memories: GraphNode[];
  decisions: GraphNode[];
  specs: GraphNode[];
  preferences: GraphNode[];
  retros: GraphNode[];
  tasks: GraphNode[];
  messages: GraphNode[];
  documents: GraphNode[];
  meetings: GraphNode[];
  people: GraphNode[];
  orgs: GraphNode[];
  issues: GraphNode[];
  mergeRequests: GraphNode[];
  commits: GraphNode[];
  projects: GraphNode[];
  jiraProjects: GraphNode[];
  confluenceSpaces: GraphNode[];
  figmaTeams: GraphNode[];
  figmaProjects: GraphNode[];
  channels: GraphNode[];
  repos: GraphNode[];
  unknown: GraphNode[];
}

async function fetchNodes(): Promise<FetchedNodes> {
  const results = await Promise.all([
    runQuery(QUERY_MEMORIES),        //  0
    runQuery(QUERY_DECISIONS),       //  1
    runQuery(QUERY_SPECS),           //  2
    runQuery(QUERY_PREFERENCES),     //  3
    runQuery(QUERY_RETROS),          //  4
    runQuery(QUERY_TASKS),           //  5
    runQuery(QUERY_MESSAGES),        //  6
    runQuery(QUERY_DOCUMENTS),       //  7
    runQuery(QUERY_MEETINGS),        //  8
    runQuery(QUERY_PEOPLE),          //  9
    runQuery(QUERY_ORGS),            // 10
    runQuery(QUERY_ISSUES),          // 11
    runQuery(QUERY_MRS),             // 12
    runQuery(QUERY_COMMITS),         // 13
    runQuery(QUERY_PROJECTS),        // 14
    runQuery(QUERY_JIRA_PROJECTS),   // 15
    runQuery(QUERY_CONFLUENCE_SPACES), // 16
    runQuery(QUERY_FIGMA_TEAMS),     // 17
    runQuery(QUERY_FIGMA_PROJECTS),  // 18
    runQuery(QUERY_CHANNELS),        // 19
    runQuery(QUERY_REPOS),           // 20
    runQuery(QUERY_UNKNOWN),         // 21
  ]);

  const nodeMap = new Map<string, GraphNode>();

  function collect(result: Awaited<ReturnType<typeof runQuery>>): GraphNode[] {
    const out: GraphNode[] = [];
    for (const record of result.records) {
      const elementId = String(record.get("elementId"));
      const labels = record.get("labels") as string[];
      const props = record.get("props") as Record<string, unknown>;
      const node = mapNode(labels, props, elementId);
      if (node) {
        nodeMap.set(elementId, node);
        out.push(node);
      }
    }
    return out;
  }

  return {
    nodeMap,
    memories: collect(results[0]),
    decisions: collect(results[1]),
    specs: collect(results[2]),
    preferences: collect(results[3]),
    retros: collect(results[4]),
    tasks: collect(results[5]),
    messages: collect(results[6]),
    documents: collect(results[7]),
    meetings: collect(results[8]),
    people: collect(results[9]),
    orgs: collect(results[10]),
    issues: collect(results[11]),
    mergeRequests: collect(results[12]),
    commits: collect(results[13]),
    projects: collect(results[14]),
    jiraProjects: collect(results[15]),
    confluenceSpaces: collect(results[16]),
    figmaTeams: collect(results[17]),
    figmaProjects: collect(results[18]),
    channels: collect(results[19]),
    repos: collect(results[20]),
    unknown: collect(results[21]),
  };
}

async function fetchEdges(nodeMap: Map<string, GraphNode>): Promise<GraphEdge[]> {
  const result = await runQuery(QUERY_EDGES);
  const edges: GraphEdge[] = [];

  for (const record of result.records) {
    const sourceElementId = String(record.get("sourceElementId"));
    const targetElementId = String(record.get("targetElementId"));

    // Only include edges where both endpoints landed in our node map.
    const sourceNode = nodeMap.get(sourceElementId);
    const targetNode = nodeMap.get(targetElementId);
    if (!sourceNode || !targetNode) continue;

    edges.push(
      mapEdge(
        String(record.get("relType")),
        String(record.get("elementId")),
        sourceNode.id,
        targetNode.id,
        record.get("props") as Record<string, unknown>,
      ),
    );
  }

  return edges;
}

function buildScene(fetched: FetchedNodes, edges: GraphEdge[]): GraphSceneData {
  const nodeToCloudId = new Map<string, string>();

  function registerCloud(nodes: GraphNode[], cloudId: string) {
    for (const n of nodes) nodeToCloudId.set(n.id, cloudId);
  }

  const memoryNodes: GraphNode[] = [
    ...fetched.memories, ...fetched.decisions, ...fetched.specs,
    ...fetched.preferences, ...fetched.retros,
  ];
  const contentNodes: GraphNode[] = [
    ...fetched.messages, ...fetched.documents, ...fetched.meetings,
  ];
  const peopleNodes: GraphNode[] = [...fetched.people, ...fetched.orgs];
  const workNodes: GraphNode[] = [
    ...fetched.issues, ...fetched.mergeRequests, ...fetched.commits,
  ];
  const containerNodes: GraphNode[] = [
    ...fetched.projects, ...fetched.jiraProjects, ...fetched.confluenceSpaces,
    ...fetched.figmaTeams, ...fetched.figmaProjects, ...fetched.channels,
    ...fetched.repos,
  ];

  registerCloud(memoryNodes, "memory-cloud");
  registerCloud(fetched.tasks, "task-cloud");
  registerCloud(contentNodes, "content-cloud");
  registerCloud(peopleNodes, "people-cloud");
  registerCloud(workNodes, "work-cloud");
  registerCloud(containerNodes, "container-cloud");
  registerCloud(fetched.unknown, "unknown-cloud");

  const cloudEdges: Record<string, GraphEdge[]> = {
    "memory-cloud": [],
    "task-cloud": [],
    "content-cloud": [],
    "people-cloud": [],
    "work-cloud": [],
    "container-cloud": [],
    "unknown-cloud": [],
    "cross-cloud": [],
  };

  for (const edge of edges) {
    const srcCloud = nodeToCloudId.get(edge.source);
    const dstCloud = nodeToCloudId.get(edge.target);
    if (srcCloud && srcCloud === dstCloud) {
      cloudEdges[srcCloud].push(edge);
    } else {
      cloudEdges["cross-cloud"].push(edge);
    }
  }

  const clouds: GraphCloud[] = [];

  if (memoryNodes.length > 0) {
    clouds.push({
      id: "memory-cloud",
      label: "Memory",
      domain: "mixed",
      nodes: memoryNodes,
      edges: cloudEdges["memory-cloud"],
    });
  }

  if (fetched.tasks.length > 0) {
    clouds.push({
      id: "task-cloud",
      label: "Tasks",
      domain: "task",
      nodes: fetched.tasks,
      edges: cloudEdges["task-cloud"],
    });
  }

  if (contentNodes.length > 0) {
    clouds.push({
      id: "content-cloud",
      label: "Content",
      domain: "mixed",
      nodes: contentNodes,
      edges: cloudEdges["content-cloud"],
    });
  }

  if (peopleNodes.length > 0) {
    clouds.push({
      id: "people-cloud",
      label: "People & Orgs",
      domain: "mixed",
      nodes: peopleNodes,
      edges: cloudEdges["people-cloud"],
    });
  }

  if (workNodes.length > 0) {
    clouds.push({
      id: "work-cloud",
      label: "Work items",
      domain: "mixed",
      nodes: workNodes,
      edges: cloudEdges["work-cloud"],
    });
  }

  if (containerNodes.length > 0) {
    clouds.push({
      id: "container-cloud",
      label: "Containers",
      domain: "mixed",
      nodes: containerNodes,
      edges: cloudEdges["container-cloud"],
    });
  }

  if (fetched.unknown.length > 0) {
    clouds.push({
      id: "unknown-cloud",
      label: "Unknown",
      domain: "unknown",
      nodes: fetched.unknown,
      edges: cloudEdges["unknown-cloud"],
    });
  }

  // Cross-cloud edges are attached to the first cloud so the renderer
  // still draws them (it already handles endpoints spanning clouds).
  if (cloudEdges["cross-cloud"].length > 0 && clouds.length > 0) {
    clouds[0].edges = [...clouds[0].edges, ...cloudEdges["cross-cloud"]];
  }

  return {
    id: "neocortex-live",
    label: "Neocortex",
    generatedAt: new Date().toISOString(),
    graphs: clouds,
  };
}

export async function fetchGraphScene(): Promise<GraphSceneData> {
  const fetched = await fetchNodes();
  const edges = await fetchEdges(fetched.nodeMap);
  return buildScene(fetched, edges);
}
