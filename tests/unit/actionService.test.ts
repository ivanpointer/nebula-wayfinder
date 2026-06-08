import { describe, expect, it } from "vitest";
import { mockGraphScene } from "../../src/data/mockGraphScene";
import { createActionService } from "../../src/services/actionService";

describe("action service", () => {
  it("marks task nodes as complete in memory", () => {
    const service = createActionService(mockGraphScene);
    const updated = service.execute("task.markDone", "task-follow-up");
    const task = updated.graphs.flatMap((graph) => graph.nodes).find((node) => node.id === "task-follow-up");

    expect(task?.status).toBe("complete");
    expect(task?.domain === "task" && task.completed).toBe(true);
  });

  it("changes task priority without mutating the original fixture", () => {
    const service = createActionService(mockGraphScene);
    const updated = service.execute("task.priority.low", "task-write-spec");
    const task = updated.graphs.flatMap((graph) => graph.nodes).find((node) => node.id === "task-write-spec");
    const original = mockGraphScene.graphs.flatMap((graph) => graph.nodes).find((node) => node.id === "task-write-spec");

    expect(task?.domain === "task" && task.priority).toBe("low");
    expect(original?.domain === "task" && original.priority).toBe("urgent");
  });
});
