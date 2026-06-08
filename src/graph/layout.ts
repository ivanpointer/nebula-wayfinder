import type { GraphCloud, GraphNode, VectorTuple } from "../domain/types";

export interface PositionedNode {
  graphId: string;
  node: GraphNode;
  position: VectorTuple;
}

export function layoutGraphClouds(graphs: GraphCloud[]): PositionedNode[] {
  const cloudSpacing = 11;

  return graphs.flatMap((graph, graphIndex) => {
    const cloudOrigin = {
      x: (graphIndex - (graphs.length - 1) / 2) * cloudSpacing,
      y: 0,
      z: graphIndex % 2 === 0 ? 0 : -2.5,
    };

    return graph.nodes.map((node, nodeIndex) => ({
      graphId: graph.id,
      node,
      position: node.fixedPosition ?? positionNodeInCloud(cloudOrigin, nodeIndex, graph.nodes.length),
    }));
  });
}

function positionNodeInCloud(origin: VectorTuple, index: number, total: number): VectorTuple {
  if (total === 1) {
    return origin;
  }

  const angle = (index / total) * Math.PI * 2;
  const radius = Math.max(2.4, total * 0.56);
  const lift = ((index % 3) - 1) * 0.85;

  return {
    x: origin.x + Math.cos(angle) * radius,
    y: origin.y + lift,
    z: origin.z + Math.sin(angle) * radius,
  };
}
