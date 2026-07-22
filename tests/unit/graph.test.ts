import { describe, expect, it } from "vitest";
import { makeEdgeCurve, pointBeforeTarget } from "../../src/graph/edgeCurves";
import { arrangeNodes, layoutGraphClouds } from "../../src/graph/layout";
import { mockGraphScene } from "../../src/data/mockGraphScene";
import type { GraphCloud } from "../../src/domain/types";

describe("graph layout", () => {
  it("positions every node across multiple graph clouds", () => {
    const positioned = layoutGraphClouds(mockGraphScene.graphs);
    const nodeCount = mockGraphScene.graphs.reduce((total, graph) => total + graph.nodes.length, 0);

    expect(positioned).toHaveLength(nodeCount);
    expect(new Set(positioned.map((node) => node.graphId)).size).toBe(mockGraphScene.graphs.length);
  });

  it("places directed targets after their sources", () => {
    // memory-cloud has a directed linked_to edge decision-sample-1 → memory-sample-1.
    const memoryCloud = graphById("memory-cloud");
    const positions = arrangeNodes(memoryCloud.nodes, memoryCloud.edges);

    memoryCloud.edges
      .filter((edge) => edge.directed && positions.has(edge.source) && positions.has(edge.target))
      .forEach((edge) => {
        expect(positions.get(edge.target)?.x).toBeGreaterThan(positions.get(edge.source)?.x ?? Number.NEGATIVE_INFINITY);
      });
  });

  it("isolates disconnected components into separate clouds", () => {
    // memory-cloud has one edge (decision → memory) leaving retro isolated.
    const graph = graphById("memory-cloud");
    const positions = arrangeNodes(graph.nodes, graph.edges);
    const connected = positions.get("memory-sample-1");
    const disconnected = positions.get("retro-sample-1");

    expect(connected).toBeDefined();
    expect(disconnected).toBeDefined();
    expect(Math.abs((connected?.x ?? 0) - (disconnected?.x ?? 0))).toBeGreaterThan(2);
  });
});

describe("edge curves", () => {
  it("creates lifted curved edge points", () => {
    const points = makeEdgeCurve({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 });

    expect(points).toHaveLength(25);
    expect(points[0].x).toBe(0);
    expect(points.at(-1)?.x).toBe(4);
    expect(Math.max(...points.map((point) => point.y))).toBeGreaterThan(0.5);
  });

  it("finds a point near the target along the curve", () => {
    const points = makeEdgeCurve({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 });
    const target = points[points.length - 1];
    const point = pointBeforeTarget(points, target, 0.5);

    expect(point.x).toBeGreaterThan(3.3);
    expect(point.x).toBeLessThan(4);
  });
});

function graphById(id: string): GraphCloud {
  const graph = mockGraphScene.graphs.find((item) => item.id === id);
  if (!graph) {
    throw new Error(`Missing fixture graph: ${id}`);
  }

  return graph;
}
