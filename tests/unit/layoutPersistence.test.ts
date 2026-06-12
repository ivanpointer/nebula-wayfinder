import { describe, expect, it } from "vitest";
import { mockGraphScene } from "../../src/data/mockGraphScene";
import {
  applyStoredNodePositions,
  clearFixedNodePositions,
  clearStoredNodePositions,
  readStoredNodePositions,
  writeStoredNodePositions,
} from "../../src/services/layoutPersistence";

class MemoryStorage {
  private items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

describe("layout persistence", () => {
  it("round-trips valid node positions through storage", () => {
    const storage = new MemoryStorage();
    const positions = {
      "task-follow-up": { x: 1.5, y: 2.25, z: -3 },
      "contact-alex": { x: -4, y: 1, z: 0.75 },
    };

    writeStoredNodePositions(positions, storage);

    expect(readStoredNodePositions(storage)).toEqual(positions);
  });

  it("ignores malformed stored positions", () => {
    const storage = new MemoryStorage();
    storage.setItem("nebula-wayfinder:node-positions:v1", JSON.stringify({ "task-follow-up": { x: 1, y: "2", z: 3 } }));

    expect(readStoredNodePositions(storage)).toEqual({});
  });

  it("overlays stored node positions without mutating the source scene", () => {
    const scene = structuredClone(mockGraphScene);
    const updated = applyStoredNodePositions(scene, {
      "todo-follow-up": { x: 8, y: 3, z: -2 },
    });
    const updatedNode = updated.graphs.flatMap((graph) => graph.nodes).find((node) => node.id === "todo-follow-up");
    const sourceNode = scene.graphs.flatMap((graph) => graph.nodes).find((node) => node.id === "todo-follow-up");

    expect(updatedNode?.fixedPosition).toEqual({ x: 8, y: 3, z: -2 });
    expect(sourceNode?.fixedPosition).toBeUndefined();
  });

  it("clears fixed positions from a scene and storage", () => {
    const storage = new MemoryStorage();
    writeStoredNodePositions({ "todo-follow-up": { x: 8, y: 3, z: -2 } }, storage);

    const fixedScene = applyStoredNodePositions(mockGraphScene, {
      "todo-follow-up": { x: 8, y: 3, z: -2 },
    });
    const clearedScene = clearFixedNodePositions(fixedScene);
    const clearedNode = clearedScene.graphs.flatMap((graph) => graph.nodes).find((node) => node.id === "todo-follow-up");

    clearStoredNodePositions(storage);

    expect(clearedNode?.fixedPosition).toBeUndefined();
    expect(readStoredNodePositions(storage)).toEqual({});
  });
});
