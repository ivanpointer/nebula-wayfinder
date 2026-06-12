/**
 * ActionService — executes user-initiated mutations against unibrain's Neo4j.
 *
 * After each mutation the local scene clone is also updated so the UI reflects
 * the change immediately without a full re-fetch.  A background re-fetch is
 * triggered so the scene eventually converges with the database.
 */

import { runQuery } from "./neo4jClient";
import { fetchGraphScene } from "./graphService";
import type {
  ActionId,
  GraphNode,
  GraphSceneData,
  NodeAction,
  Priority,
  TodoNode,
} from "../domain/types";

export interface ActionService {
  getActions(node: GraphNode): NodeAction[];
  execute(actionId: ActionId, nodeId: string): Promise<GraphSceneData>;
  getScene(): GraphSceneData;
}

// ---------------------------------------------------------------------------
// Neo4j mutations
// ---------------------------------------------------------------------------

// Mark a Todo as done.
const CYPHER_MARK_DONE = `
MATCH (t:Todo {todo_key: $todoKey})
SET t.status = 'done', t.updated_at = datetime()
`;

// Cancel / dismiss a Todo.
const CYPHER_DISMISS = `
MATCH (t:Todo {todo_key: $todoKey})
SET t.status = 'canceled', t.updated_at = datetime()
`;

// Update priority on a Todo.
const CYPHER_SET_PRIORITY = `
MATCH (t:Todo {todo_key: $todoKey})
SET t.priority = $priority, t.updated_at = datetime()
`;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createActionService(initialScene: GraphSceneData): ActionService {
  let scene = structuredClone(initialScene);

  return {
    getActions(node) {
      // Only actionable on open/draft Todos.
      if (node.domain !== "todo") return [];
      const todo = node as TodoNode;
      if (todo.todoStatus === "done" || todo.todoStatus === "canceled") return [];

      const priorityActions: NodeAction[] = (["low", "medium", "high", "urgent"] as Priority[])
        .filter((p) => p !== todo.priority)
        .map((p) => ({
          id: `todo.priority.${p}` as ActionId,
          label: `Priority: ${p}`,
          nodeId: node.id,
          domain: "todo" as const,
        }));

      return [
        { id: "todo.markDone", label: "Mark done", nodeId: node.id, domain: "todo" },
        { id: "todo.dismiss",  label: "Dismiss",   nodeId: node.id, domain: "todo" },
        ...priorityActions,
      ];
    },

    async execute(actionId, nodeId) {
      // 1. Optimistic local update so the UI responds immediately.
      scene = applyLocalAction(scene, nodeId, actionId);

      // 2. Persist to Neo4j.  The nodeId is the todo_key.
      try {
        await persistAction(nodeId, actionId);
      } catch (err) {
        console.error("[nebula-wayfinder] Neo4j mutation failed:", err);
        // On failure, trigger a full re-fetch to resync from the DB.
        fetchGraphScene()
          .then((fresh) => { scene = fresh; })
          .catch((e) => console.error("[nebula-wayfinder] Re-fetch after failed mutation failed:", e));
      }

      return structuredClone(scene);
    },

    getScene() {
      return structuredClone(scene);
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function persistAction(todoKey: string, actionId: ActionId): Promise<void> {
  if (actionId === "todo.markDone") {
    await runQuery(CYPHER_MARK_DONE, { todoKey });
    return;
  }

  if (actionId === "todo.dismiss") {
    await runQuery(CYPHER_DISMISS, { todoKey });
    return;
  }

  if (actionId.startsWith("todo.priority.")) {
    const priority = actionId.replace("todo.priority.", "") as Priority;
    await runQuery(CYPHER_SET_PRIORITY, { todoKey, priority });
    return;
  }
}

function applyLocalAction(scene: GraphSceneData, nodeId: string, actionId: ActionId): GraphSceneData {
  return {
    ...scene,
    graphs: scene.graphs.map((cloud) => ({
      ...cloud,
      nodes: cloud.nodes.map((node) => {
        if (node.id !== nodeId || node.domain !== "todo") return node;
        return applyTodoAction(node as TodoNode, actionId);
      }),
    })),
  };
}

function applyTodoAction(todo: TodoNode, actionId: ActionId): TodoNode {
  if (actionId === "todo.markDone") {
    return { ...todo, todoStatus: "done", status: "complete" };
  }

  if (actionId === "todo.dismiss") {
    return { ...todo, todoStatus: "canceled", status: "dismissed" };
  }

  if (actionId.startsWith("todo.priority.")) {
    const priority = actionId.replace("todo.priority.", "") as Priority;
    return { ...todo, priority };
  }

  return todo;
}
