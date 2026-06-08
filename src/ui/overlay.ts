import type { ActionService } from "../services/actionService";
import type { ActionId, GraphSceneData, GraphNode, Selection } from "../domain/types";

interface OverlayOptions {
  inspector: HTMLElement;
  toolbar: HTMLElement;
  legend: HTMLElement;
  graphScene: GraphSceneData;
  actionService: ActionService;
}

type ActionListener = (scene: GraphSceneData) => void;

export function createOverlay(options: OverlayOptions) {
  const listeners = new Set<ActionListener>();
  let activeSelection: Selection = null;

  const renderSelection = (selection: Selection): void => {
    activeSelection = selection;
    if (!selection) {
      options.inspector.innerHTML = `
        <div class="eyebrow">No selection</div>
        <h1 class="title">Explore the graph</h1>
        <p class="empty-state">Click a node or edge to inspect its domain fields, relationship metadata, and available actions.</p>
      `;
      return;
    }

    if (selection.type === "edge") {
      renderEdge(selection);
      return;
    }

    renderNode(selection.node);
  };

  const renderChrome = (): void => {
    const nodeCount = options.graphScene.graphs.reduce((total, graph) => total + graph.nodes.length, 0);
    const edgeCount = options.graphScene.graphs.reduce((total, graph) => total + graph.edges.length, 0);
    options.toolbar.innerHTML = `
      <div class="toolbar-title">Nebula Wayfinder</div>
      <div class="toolbar-stat"><span>Clouds</span><strong>${options.graphScene.graphs.length}</strong></div>
      <div class="toolbar-stat"><span>Nodes</span><strong>${nodeCount}</strong></div>
      <div class="toolbar-stat"><span>Edges</span><strong>${edgeCount}</strong></div>
    `;

    options.legend.innerHTML = [
      ["#4fd1c5", "Tasks"],
      ["#f5c76b", "Contacts"],
      ["#8fb3ff", "Email"],
      ["#c77dff", "Messages"],
      ["#ff7a59", "AI sessions"],
    ]
      .map(
        ([color, label]) => `
          <div class="legend-item">
            <span class="swatch" style="color: ${color}; background: ${color}"></span>
            <span>${label}</span>
          </div>
        `,
      )
      .join("");
  };

  const renderNode = (node: GraphNode): void => {
    const actions = options.actionService.getActions(node);
    options.inspector.innerHTML = `
      <div class="eyebrow">${escapeHtml(node.domain)} node</div>
      <h1 class="title">${escapeHtml(node.label)}</h1>
      <p class="summary">${escapeHtml(summaryForNode(node))}</p>
      ${fields(nodeFields(node))}
      ${
        actions.length
          ? `<div class="actions">${actions
              .map((action) => `<button data-action="${action.id}" data-node-id="${action.nodeId}">${action.label}</button>`)
              .join("")}</div>`
          : ""
      }
    `;

    options.inspector.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const actionId = button.dataset.action as ActionId;
        const nodeId = button.dataset.nodeId;
        if (!nodeId) {
          return;
        }

        const updatedScene = options.actionService.execute(actionId, nodeId);
        listeners.forEach((listener) => listener(updatedScene));
      });
    });
  };

  const renderEdge = (edge: NonNullable<Selection> & { type: "edge" }) => {
    options.inspector.innerHTML = `
      <div class="eyebrow">${edge.edge.directed ? "Directed" : "Undirected"} edge</div>
      <h1 class="title">${escapeHtml(edge.edge.label ?? edge.edge.kind)}</h1>
      <p class="summary">${escapeHtml(edge.edge.source)} -> ${escapeHtml(edge.edge.target)}</p>
      ${fields([
        ["Kind", edge.edge.kind],
        ["Direction", edge.edge.directed ? "Directed" : "Undirected"],
        ["Metadata", JSON.stringify(edge.edge.metadata ?? {}, null, 2)],
      ])}
    `;
  };

  renderChrome();
  renderSelection(null);

  return {
    renderSelection,
    onActionResult(listener: ActionListener) {
      listeners.add(listener);
    },
  };
}

function nodeFields(node: GraphNode): Array<[string, string]> {
  const shared: Array<[string, string]> = [
    ["Status", node.status],
    ["Source", `${node.source.system}:${node.source.externalId}`],
  ];

  if (node.domain === "task") {
    return [
      ["Title", node.title],
      ["Priority", node.priority],
      ["Project", node.project ?? "None"],
      ["Due", node.dueDate ?? "Unscheduled"],
      ["Completed", node.completed ? "Yes" : "No"],
      ...shared,
    ];
  }

  if (node.domain === "agent-session") {
    return [
      ["Agent", node.agentName],
      ["Runtime", node.runtime],
      ["Model", node.model],
      ["Session", node.sessionStatus],
      ["Updated", formatDate(node.updatedAt)],
      ["Artifacts", node.relatedArtifacts.map((artifact) => artifact.externalId).join(", ") || "None"],
      ...shared,
    ];
  }

  if (node.domain === "contact") {
    return [
      ["Name", node.name],
      ["Organization", node.organization ?? "Unknown"],
      ["Role", node.role ?? "Unknown"],
      ...shared,
    ];
  }

  if (node.domain === "email") {
    return [
      ["Sender", node.sender],
      ["Subject", node.subject],
      ["Time", formatDate(node.timestamp)],
      ["Unread", node.unread ? "Yes" : "No"],
      ["Follow up", node.followUp ? "Yes" : "No"],
      ...shared,
    ];
  }

  return [
    ["Sender", node.sender],
    ["Channel", node.channel],
    ["Thread", node.thread ?? "None"],
    ["Time", formatDate(node.timestamp)],
    ["Follow up", node.followUp ? "Yes" : "No"],
    ...shared,
  ];
}

function summaryForNode(node: GraphNode): string {
  if (node.domain === "agent-session") {
    return node.taskSummary;
  }

  if (node.domain === "task") {
    return node.title;
  }

  if (node.domain === "email") {
    return node.subject;
  }

  if (node.domain === "message") {
    return node.thread ?? node.channel;
  }

  return [node.role, node.organization].filter(Boolean).join(" at ") || node.name;
}

function fields(items: Array<[string, string]>): string {
  return `<dl class="field-list">${items
    .map(
      ([label, value]) => `
        <div class="field">
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
        </div>
      `,
    )
    .join("")}</dl>`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
