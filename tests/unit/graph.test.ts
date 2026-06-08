import { describe, expect, it } from "vitest";
import { makeEdgeCurve } from "../../src/graph/edgeCurves";
import { layoutGraphClouds } from "../../src/graph/layout";
import { mockGraphScene } from "../../src/data/mockGraphScene";

describe("graph layout", () => {
  it("positions every node across multiple graph clouds", () => {
    const positioned = layoutGraphClouds(mockGraphScene.graphs);
    const nodeCount = mockGraphScene.graphs.reduce((total, graph) => total + graph.nodes.length, 0);

    expect(positioned).toHaveLength(nodeCount);
    expect(new Set(positioned.map((node) => node.graphId)).size).toBe(mockGraphScene.graphs.length);
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
});
