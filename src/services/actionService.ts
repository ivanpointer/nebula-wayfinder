import type { ActionId, GraphNode, GraphSceneData, NodeAction, Priority, TaskNode } from "../domain/types";

export interface ActionService {
  getActions(node: GraphNode): NodeAction[];
  execute(actionId: ActionId, nodeId: string): GraphSceneData;
  getScene(): GraphSceneData;
}

export function createActionService(initialScene: GraphSceneData): ActionService {
  let scene = structuredClone(initialScene);

  return {
    getActions(node) {
      if (node.domain !== "task" || node.completed || node.dismissed) {
        return [];
      }

      const priorityActions: NodeAction[] = (["low", "medium", "high", "urgent"] as Priority[])
        .filter((priority) => priority !== node.priority)
        .map((priority) => ({
          id: `task.priority.${priority}` as ActionId,
          label: `Priority: ${priority}`,
          nodeId: node.id,
          domain: "task",
        }));

      return [
        { id: "task.markDone", label: "Mark done", nodeId: node.id, domain: "task" },
        { id: "task.dismiss", label: "Dismiss", nodeId: node.id, domain: "task" },
        ...priorityActions,
      ];
    },

    execute(actionId, nodeId) {
      scene = updateTaskNode(scene, nodeId, (task) => applyTaskAction(task, actionId));
      return structuredClone(scene);
    },

    getScene() {
      return structuredClone(scene);
    },
  };
}

function updateTaskNode(
  scene: GraphSceneData,
  nodeId: string,
  update: (task: TaskNode) => TaskNode,
): GraphSceneData {
  return {
    ...scene,
    graphs: scene.graphs.map((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => {
        if (node.id !== nodeId || node.domain !== "task") {
          return node;
        }

        return update(node);
      }),
    })),
  };
}

function applyTaskAction(task: TaskNode, actionId: ActionId): TaskNode {
  if (actionId === "task.markDone") {
    return { ...task, completed: true, status: "complete" };
  }

  if (actionId === "task.dismiss") {
    return { ...task, dismissed: true, status: "dismissed" };
  }

  if (actionId.startsWith("task.priority.")) {
    const priority = actionId.replace("task.priority.", "") as Priority;
    return { ...task, priority };
  }

  return task;
}
