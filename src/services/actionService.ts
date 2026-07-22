/**
 * ActionService — placeholder while the neocortex backend has no
 * front-end mutation surface wired up. Actions used to write Todo
 * mutations directly into unibrain's Neo4j; neocortex owns writes
 * through its Python pipelines, so we no longer poke Neo4j from
 * the browser.
 *
 * `getActions` returns [] for every node, so the inspector renders
 * no action buttons. `execute` is a no-op that just returns the
 * current scene. The API shape is kept intact for a future
 * neocortex REST/MCP surface.
 */

import type {
  ActionId,
  GraphNode,
  GraphSceneData,
  NodeAction,
} from "../domain/types";

export interface ActionService {
  getActions(node: GraphNode): NodeAction[];
  execute(actionId: ActionId, nodeId: string): Promise<GraphSceneData>;
  getScene(): GraphSceneData;
}

export function createActionService(initialScene: GraphSceneData): ActionService {
  let scene = structuredClone(initialScene);

  return {
    getActions(_node: GraphNode): NodeAction[] {
      return [];
    },

    async execute(_actionId, _nodeId): Promise<GraphSceneData> {
      return structuredClone(scene);
    },

    getScene() {
      return structuredClone(scene);
    },
  };
}
