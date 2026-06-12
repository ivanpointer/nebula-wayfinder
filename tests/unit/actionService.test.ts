import { describe, expect, it, vi } from "vitest";
import { mockGraphScene } from "../../src/data/mockGraphScene";
import { createActionService } from "../../src/services/actionService";

// Stub the neo4j runQuery so tests don't need a live database.
vi.mock("../../src/services/neo4jClient", () => ({
  runQuery: vi.fn().mockResolvedValue({ records: [] }),
}));

describe("action service", () => {
  it("marks todo nodes as complete in memory", async () => {
    const service = createActionService(mockGraphScene);
    const updated = await service.execute("todo.markDone", "todo-follow-up");
    const node = updated.graphs.flatMap((graph) => graph.nodes).find((n) => n.id === "todo-follow-up");

    expect(node?.status).toBe("complete");
    expect(node?.domain === "todo" && node.todoStatus).toBe("done");
  });

  it("changes todo priority without mutating the original fixture", async () => {
    const service = createActionService(mockGraphScene);
    const updated = await service.execute("todo.priority.low", "todo-write-spec");
    const node = updated.graphs.flatMap((graph) => graph.nodes).find((n) => n.id === "todo-write-spec");
    const original = mockGraphScene.graphs.flatMap((graph) => graph.nodes).find((n) => n.id === "todo-write-spec");

    expect(node?.domain === "todo" && node.priority).toBe("low");
    expect(original?.domain === "todo" && original.priority).toBe("urgent");
  });
});
