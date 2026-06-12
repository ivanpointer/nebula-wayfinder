/**
 * Fetches the live graph scene from the unibrain Neo4j instance.
 *
 * The scene is divided into clouds that mirror unibrain's primary node types.
 * Nodes that cannot be mapped (unknown labels) are silently dropped, so new
 * unibrain types degrade gracefully until a mapper is added.
 *
 * Edges are fetched in a second pass to keep the Cypher readable and avoid
 * a cartesian explosion when combining multiple node types.
 */

import { runQuery } from "./neo4jClient";
import { mapNode, mapEdge } from "./neo4jMapper";
import type { GraphSceneData, GraphCloud, GraphNode, GraphEdge } from "../domain/types";

// ---------------------------------------------------------------------------
// Node queries — one per primary label
// ---------------------------------------------------------------------------

// Fetch open/draft Todos — the core productivity view.
const QUERY_TODOS = `
MATCH (t:Todo)
WHERE t.status IN ['open', 'in_progress', 'waiting'] OR t.review_status = 'draft'
RETURN
  elementId(t) AS elementId,
  labels(t)    AS labels,
  properties(t) AS props
ORDER BY
  CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
  CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END,
  t.due_at ASC
LIMIT 100
`;

// Recent emails — last 50 by received_at.
const QUERY_EMAILS = `
MATCH (e:EmailMessage)
RETURN
  elementId(e) AS elementId,
  labels(e)    AS labels,
  properties(e) AS props
ORDER BY e.received_at DESC
LIMIT 50
`;

// People who sent or received recent emails.
const QUERY_PEOPLE = `
MATCH (p:Person)
WHERE EXISTS { (p)-[:SENT|RECEIVED|CC_RECEIVED]-(:EmailMessage) }
RETURN
  elementId(p) AS elementId,
  labels(p)    AS labels,
  properties(p) AS props
LIMIT 100
`;

// Draft action proposals waiting for review.
const QUERY_PROPOSALS = `
MATCH (ap:ActionProposal)
WHERE ap.status = 'draft'
RETURN
  elementId(ap) AS elementId,
  labels(ap)    AS labels,
  properties(ap) AS props
ORDER BY ap.created_at DESC
LIMIT 50
`;

// ---------------------------------------------------------------------------
// Edge queries — relationships between the node sets above
// ---------------------------------------------------------------------------

// Relationships between the node types we actually fetch.
const QUERY_EDGES = `
MATCH (a)-[r]->(b)
WHERE
  (a:Todo OR a:EmailMessage OR a:Person OR a:Organization OR a:ActionProposal)
  AND
  (b:Todo OR b:EmailMessage OR b:Person OR b:Organization OR b:ActionProposal)
  AND type(r) IN [
    'SENT_BY', 'SENT_TO', 'CC_TO',
    'HAS_TODO',
    'PRODUCED', 'EVIDENCED_BY',
    'HAS_EMAIL', 'WORKS_AT',
    'SENT', 'RECEIVED'
  ]
RETURN
  elementId(r)  AS elementId,
  type(r)       AS relType,
  elementId(a)  AS sourceElementId,
  elementId(b)  AS targetElementId,
  properties(r) AS props
LIMIT 500
`;

// Organization nodes that appear on the other end of WORKS_AT edges.
const QUERY_ORGS = `
MATCH (p:Person)-[:WORKS_AT]->(o:Organization)
RETURN
  elementId(o) AS elementId,
  labels(o)    AS labels,
  properties(o) AS props
LIMIT 50
`;

// ---------------------------------------------------------------------------
// Build the scene
// ---------------------------------------------------------------------------

async function fetchNodes(): Promise<{
  nodeMap: Map<string, GraphNode>;
  todos: GraphNode[];
  emails: GraphNode[];
  people: GraphNode[];
  orgs: GraphNode[];
  proposals: GraphNode[];
}> {
  const [todoRes, emailRes, personRes, orgRes, proposalRes] = await Promise.all([
    runQuery(QUERY_TODOS),
    runQuery(QUERY_EMAILS),
    runQuery(QUERY_PEOPLE),
    runQuery(QUERY_ORGS),
    runQuery(QUERY_PROPOSALS),
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
    todos: collect(todoRes),
    emails: collect(emailRes),
    people: collect(personRes),
    orgs: collect(orgRes),
    proposals: collect(proposalRes),
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

function buildScene(
  todos: GraphNode[],
  emails: GraphNode[],
  people: GraphNode[],
  orgs: GraphNode[],
  proposals: GraphNode[],
  edges: GraphEdge[],
): GraphSceneData {
  // Assign each edge to the cloud that contains its source node.
  // Edges that span clouds are placed in the cloud of the source.
  const nodeToCloudId = new Map<string, string>();

  function registerCloud(nodes: GraphNode[], cloudId: string) {
    for (const n of nodes) nodeToCloudId.set(n.id, cloudId);
  }

  registerCloud(todos, "todo-cloud");
  registerCloud(emails, "email-cloud");
  registerCloud([...people, ...orgs], "people-cloud");
  registerCloud(proposals, "proposal-cloud");

  // Separate edges by source cloud; cross-cloud edges go to a shared "links" bucket.
  const cloudEdges: Record<string, GraphEdge[]> = {
    "todo-cloud": [],
    "email-cloud": [],
    "people-cloud": [],
    "proposal-cloud": [],
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

  if (todos.length > 0) {
    clouds.push({
      id: "todo-cloud",
      label: "Todos",
      domain: "todo",
      nodes: todos,
      edges: cloudEdges["todo-cloud"],
    });
  }

  if (emails.length > 0) {
    clouds.push({
      id: "email-cloud",
      label: "Email",
      domain: "email",
      nodes: emails,
      edges: cloudEdges["email-cloud"],
    });
  }

  if (people.length > 0 || orgs.length > 0) {
    clouds.push({
      id: "people-cloud",
      label: "People & Orgs",
      domain: "mixed",
      nodes: [...people, ...orgs],
      edges: cloudEdges["people-cloud"],
    });
  }

  if (proposals.length > 0) {
    clouds.push({
      id: "proposal-cloud",
      label: "Action Proposals",
      domain: "action-proposal",
      nodes: proposals,
      edges: cloudEdges["proposal-cloud"],
    });
  }

  // Cross-cloud edges: attach to the first cloud so they are rendered.
  // The renderer already handles edges whose endpoints span clouds.
  if (cloudEdges["cross-cloud"].length > 0 && clouds.length > 0) {
    clouds[0].edges = [...clouds[0].edges, ...cloudEdges["cross-cloud"]];
  }

  return {
    id: "unibrain-live",
    label: "Unibrain",
    generatedAt: new Date().toISOString(),
    graphs: clouds,
  };
}

export async function fetchGraphScene(): Promise<GraphSceneData> {
  const { nodeMap, todos, emails, people, orgs, proposals } = await fetchNodes();
  const edges = await fetchEdges(nodeMap);
  return buildScene(todos, emails, people, orgs, proposals, edges);
}
