import type { GraphCloud, GraphEdge, GraphNode, VectorTuple } from "../domain/types";

export interface PositionedNode {
  graphId: string;
  node: GraphNode;
  position: VectorTuple;
}

export function layoutGraphClouds(graphs: GraphCloud[]): PositionedNode[] {
  const graphSpacing = 12;

  return graphs.flatMap((graph, graphIndex) => {
    const cloudOrigin = {
      x: (graphIndex - (graphs.length - 1) / 2) * graphSpacing,
      y: 0,
      z: graphIndex % 2 === 0 ? 0 : -2.5,
    };
    const arranged = arrangeNodes(graph.nodes, graph.edges, cloudOrigin);

    return graph.nodes.map((node) => ({
      graphId: graph.id,
      node,
      position: node.fixedPosition ?? arranged.get(node.id) ?? cloudOrigin,
    }));
  });
}

export function arrangeNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  origin: VectorTuple = { x: 0, y: 0, z: 0 },
): Map<string, VectorTuple> {
  const positions = new Map<string, VectorTuple>();
  const nodeIds = new Set(nodes.map((node) => node.id));
  const relevantEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const components = connectedComponents(nodes, relevantEdges);
  const layouts = components.map((component) => {
    const componentPositions = arrangeComponent(component, relevantEdges, { x: 0, y: 0, z: 0 });
    return {
      bounds: boundsFor(componentPositions),
      positions: componentPositions,
    };
  });

  packLayouts(layouts, origin).forEach((packed) => {
    packed.positions.forEach((position, nodeId) => positions.set(nodeId, position));
  });

  return positions;
}

function connectedComponents(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[][] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const neighbors = new Map(nodes.map((node) => [node.id, new Set<string>()]));

  edges.forEach((edge) => {
    neighbors.get(edge.source)?.add(edge.target);
    neighbors.get(edge.target)?.add(edge.source);
  });

  const visited = new Set<string>();
  const components: GraphNode[][] = [];

  nodes.forEach((node) => {
    if (visited.has(node.id)) {
      return;
    }

    const queue = [node.id];
    const component: GraphNode[] = [];
    visited.add(node.id);

    while (queue.length > 0) {
      const nodeId = queue.shift() as string;
      const current = nodeById.get(nodeId);
      if (current) {
        component.push(current);
      }

      neighbors.get(nodeId)?.forEach((neighborId) => {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      });
    }

    components.push(component);
  });

  return components.sort((a, b) => b.length - a.length || a[0].id.localeCompare(b[0].id));
}

function arrangeComponent(nodes: GraphNode[], edges: GraphEdge[], origin: VectorTuple): Map<string, VectorTuple> {
  if (nodes.length === 1) {
    return new Map([[nodes[0].id, origin]]);
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const componentEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const directedEdges = componentEdges.filter((edge) => edge.directed);
  const layers = assignDirectedLayers(nodes, directedEdges);
  const layerEntries = Array.from(layers.entries());
  const maxLayer = Math.max(...layerEntries.map(([, layer]) => layer), 0);
  const layerSpacing = 3.05;
  const rowSpacing = 1.85;
  const positions = new Map<string, VectorTuple>();
  const nodesByLayer = new Map<number, GraphNode[]>();

  nodes.forEach((node) => {
    const layer = layers.get(node.id) ?? 0;
    const bucket = nodesByLayer.get(layer) ?? [];
    bucket.push(node);
    nodesByLayer.set(layer, bucket);
  });

  nodesByLayer.forEach((layerNodes, layer) => {
    layerNodes.sort((a, b) => degreeScore(b.id, componentEdges) - degreeScore(a.id, componentEdges) || a.label.localeCompare(b.label));
    layerNodes.forEach((node, rowIndex) => {
      const centeredRow = rowIndex - (layerNodes.length - 1) / 2;
      const centeredLayer = layer - maxLayer / 2;
      positions.set(node.id, {
        x: origin.x + centeredLayer * layerSpacing,
        y: origin.y + centeredRow * rowSpacing,
        z: origin.z + ((rowIndex % 2) - 0.5) * 0.78,
      });
    });
  });

  relaxUndirectedEdges(positions, componentEdges.filter((edge) => !edge.directed), 0.18);
  return positions;
}

interface LayoutBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
}

interface ComponentLayout {
  bounds: LayoutBounds;
  positions: Map<string, VectorTuple>;
}

function packLayouts(layouts: ComponentLayout[], origin: VectorTuple): ComponentLayout[] {
  if (layouts.length === 0) {
    return [];
  }

  const cloudPaddingX = 5.2;
  const cloudPaddingZ = 4.2;
  const maxColumns = layouts.length <= 3 ? layouts.length : Math.ceil(Math.sqrt(layouts.length));
  const rows: ComponentLayout[][] = [];

  layouts.forEach((layout, index) => {
    const rowIndex = Math.floor(index / maxColumns);
    const row = rows[rowIndex] ?? [];
    row.push(layout);
    rows[rowIndex] = row;
  });

  const rowWidths = rows.map((row) =>
    row.reduce((width, layout, index) => width + layout.bounds.width + (index > 0 ? cloudPaddingX : 0), 0),
  );
  const rowDepths = rows.map((row) => Math.max(...row.map((layout) => layout.bounds.depth), 0));
  const totalDepth = rowDepths.reduce((depth, rowDepth, index) => depth + rowDepth + (index > 0 ? cloudPaddingZ : 0), 0);

  const packed: ComponentLayout[] = [];
  let zCursor = origin.z - totalDepth / 2;

  rows.forEach((row, rowIndex) => {
    const rowDepth = rowDepths[rowIndex];
    const rowCenterZ = zCursor + rowDepth / 2;
    let xCursor = origin.x - rowWidths[rowIndex] / 2;

    row.forEach((layout) => {
      const componentCenterX = xCursor + layout.bounds.width / 2;
      const localCenterX = (layout.bounds.minX + layout.bounds.maxX) / 2;
      const localCenterZ = (layout.bounds.minZ + layout.bounds.maxZ) / 2;
      packed.push({
        bounds: layout.bounds,
        positions: translatePositions(layout.positions, {
          x: componentCenterX - localCenterX,
          y: origin.y,
          z: rowCenterZ - localCenterZ,
        }),
      });
      xCursor += layout.bounds.width + cloudPaddingX;
    });

    zCursor += rowDepth + cloudPaddingZ;
  });

  return packed;
}

function boundsFor(positions: Map<string, VectorTuple>): LayoutBounds {
  const values = Array.from(positions.values());
  const minX = Math.min(...values.map((position) => position.x));
  const maxX = Math.max(...values.map((position) => position.x));
  const minY = Math.min(...values.map((position) => position.y));
  const maxY = Math.max(...values.map((position) => position.y));
  const minZ = Math.min(...values.map((position) => position.z));
  const maxZ = Math.max(...values.map((position) => position.z));
  const nodeClearance = 2.4;

  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    width: Math.max(maxX - minX + nodeClearance, 3.8),
    depth: Math.max(maxZ - minZ + nodeClearance, 3.4),
  };
}

function translatePositions(positions: Map<string, VectorTuple>, delta: VectorTuple): Map<string, VectorTuple> {
  return new Map(
    Array.from(positions.entries()).map(([nodeId, position]) => [
      nodeId,
      {
        x: position.x + delta.x,
        y: position.y + delta.y,
        z: position.z + delta.z,
      },
    ]),
  );
}

function assignDirectedLayers(nodes: GraphNode[], directedEdges: GraphEdge[]): Map<string, number> {
  const layers = new Map(nodes.map((node) => [node.id, 0]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));

  directedEdges.forEach((edge) => {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  });

  const queue = nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .sort((a, b) => degreeScore(b.id, directedEdges) - degreeScore(a.id, directedEdges))
    .map((node) => node.id);
  const visited = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift() as string;
    visited.add(nodeId);

    outgoing.get(nodeId)?.forEach((targetId) => {
      layers.set(targetId, Math.max(layers.get(targetId) ?? 0, (layers.get(nodeId) ?? 0) + 1));
      incoming.set(targetId, (incoming.get(targetId) ?? 1) - 1);
      if ((incoming.get(targetId) ?? 0) <= 0 && !visited.has(targetId)) {
        queue.push(targetId);
      }
    });
  }

  directedEdges.forEach((edge) => {
    if ((layers.get(edge.target) ?? 0) <= (layers.get(edge.source) ?? 0)) {
      layers.set(edge.target, (layers.get(edge.source) ?? 0) + 1);
    }
  });

  return layers;
}

function relaxUndirectedEdges(positions: Map<string, VectorTuple>, edges: GraphEdge[], strength: number): void {
  edges.forEach((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) {
      return;
    }

    const midpoint = {
      x: (source.x + target.x) / 2,
      y: (source.y + target.y) / 2,
      z: (source.z + target.z) / 2,
    };
    positions.set(edge.source, interpolate(source, midpoint, strength));
    positions.set(edge.target, interpolate(target, midpoint, strength));
  });
}

function interpolate(source: VectorTuple, target: VectorTuple, amount: number): VectorTuple {
  return {
    x: source.x + (target.x - source.x) * amount,
    y: source.y + (target.y - source.y) * amount,
    z: source.z + (target.z - source.z) * amount,
  };
}

function degreeScore(nodeId: string, edges: GraphEdge[]): number {
  return edges.reduce((score, edge) => score + (edge.source === nodeId || edge.target === nodeId ? 1 : 0), 0);
}
