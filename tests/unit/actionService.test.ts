import { describe, expect, it, vi } from "vitest";
import { mockGraphScene } from "../../src/data/mockGraphScene";
import { createActionService } from "../../src/services/actionService";

// Stub the neo4j runQuery so tests don't need a live database.
vi.mock("../../src/services/neo4jClient", () => ({
  runQuery: vi.fn().mockResolvedValue({ records: [] }),
}));

describe("action service", () => {
  it("exposes no actions for any node (neocortex has no write surface yet)", () => {
    const service = createActionService(mockGraphScene);
    for (const graph of mockGraphScene.graphs) {
      for (const node of graph.nodes) {
        expect(service.getActions(node)).toEqual([]);
      }
    }
  });

  it("getScene returns a defensive clone that does not alias the input", () => {
    const service = createActionService(mockGraphScene);
    const clone = service.getScene();
    expect(clone).not.toBe(mockGraphScene);
    expect(clone.graphs).not.toBe(mockGraphScene.graphs);
    expect(clone.id).toBe(mockGraphScene.id);
  });
});
