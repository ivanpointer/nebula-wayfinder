import type { GraphSceneData, VectorTuple } from "../domain/types";

export type NodePositionMap = Record<string, VectorTuple>;

interface LayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY = "nebula-wayfinder:node-positions:v1";

export function readStoredNodePositions(storage: LayoutStorage = window.localStorage): NodePositionMap {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    return isNodePositionMap(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeStoredNodePositions(
  positions: NodePositionMap,
  storage: LayoutStorage = window.localStorage,
): void {
  try {
    const validPositions = Object.fromEntries(
      Object.entries(positions).filter(([, position]) => isVectorTuple(position)),
    );

    if (Object.keys(validPositions).length === 0) {
      storage.removeItem(STORAGE_KEY);
      return;
    }

    storage.setItem(STORAGE_KEY, JSON.stringify(validPositions));
  } catch {
    // Layout persistence is best effort; interaction should still work without storage.
  }
}

export function clearStoredNodePositions(storage: LayoutStorage = window.localStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Layout persistence is best effort; reset should still update the active scene.
  }
}

export function applyStoredNodePositions(
  scene: GraphSceneData,
  positions: NodePositionMap,
): GraphSceneData {
  return {
    ...scene,
    graphs: scene.graphs.map((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => {
        const fixedPosition = positions[node.id];
        return fixedPosition ? { ...node, fixedPosition } : node;
      }),
    })),
  };
}

export function clearFixedNodePositions(scene: GraphSceneData): GraphSceneData {
  return {
    ...scene,
    graphs: scene.graphs.map((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => {
        if (!node.fixedPosition) {
          return node;
        }

        const { fixedPosition: _fixedPosition, ...rest } = node;
        return rest;
      }),
    })),
  };
}

function isNodePositionMap(value: unknown): value is NodePositionMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((position) => isVectorTuple(position));
}

function isVectorTuple(value: unknown): value is VectorTuple {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.x === "number" &&
    Number.isFinite(candidate.x) &&
    typeof candidate.y === "number" &&
    Number.isFinite(candidate.y) &&
    typeof candidate.z === "number" &&
    Number.isFinite(candidate.z)
  );
}
