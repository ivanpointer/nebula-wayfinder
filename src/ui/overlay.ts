import type { ActionService } from "../services/actionService";
import type {
  ActionId,
  BaseNode,
  GraphSceneData,
  GraphNode,
  Selection,
  TodoNode,
  EmailNode,
  PersonNode,
  OrganizationNode,
  ActionProposalNode,
} from "../domain/types";

const BRIGHTNESS_STORAGE_KEY = "nebula-wayfinder:brightness:v1";
const BRIGHTNESS_DEFAULT = 0.5;

export function loadBrightness(): number {
  const stored = localStorage.getItem(BRIGHTNESS_STORAGE_KEY);
  const parsed = stored !== null ? parseFloat(stored) : NaN;
  return isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : BRIGHTNESS_DEFAULT;
}

function saveBrightness(value: number): void {
  localStorage.setItem(BRIGHTNESS_STORAGE_KEY, String(value));
}

const VISIBILITY_STORAGE_KEY = "nebula-wayfinder:domain-visibility:v1";

export function loadVisibleDomains(allDomains: string[]): Set<string> {
  try {
    const raw = localStorage.getItem(VISIBILITY_STORAGE_KEY);
    if (!raw) return new Set(allDomains);
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((d) => typeof d === "string")) {
      return new Set(parsed as string[]);
    }
  } catch { /* ignore */ }
  return new Set(allDomains);
}

function saveVisibleDomains(visible: Set<string>): void {
  localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify([...visible]));
}

interface OverlayOptions {
  inspector: HTMLElement;
  toolbar: HTMLElement;
  legend: HTMLElement;
  graphScene: GraphSceneData;
  actionService: ActionService;
  onBrightnessChange: (value: number) => void;
  onVisibilityChange: (visible: Set<string>) => void;
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

    if (selection.type === "nodes") {
      renderNodeGroup(selection.nodes);
      return;
    }

    renderNode(selection.node);
  };

  const renderChrome = (): void => {
    const nodeCount = options.graphScene.graphs.reduce((total, graph) => total + graph.nodes.length, 0);
    const edgeCount = options.graphScene.graphs.reduce((total, graph) => total + graph.edges.length, 0);
    const brightness = loadBrightness();
    options.toolbar.innerHTML = `
      <div class="toolbar-title">Nebula Wayfinder</div>
      <div class="toolbar-stat"><span>Clouds</span><strong>${options.graphScene.graphs.length}</strong></div>
      <div class="toolbar-stat"><span>Nodes</span><strong>${nodeCount}</strong></div>
      <div class="toolbar-stat"><span>Edges</span><strong>${edgeCount}</strong></div>
      <label class="toolbar-slider-label">
        <span>Brightness</span>
        <input type="range" class="toolbar-slider" data-control="brightness"
          min="0" max="1" step="0.01" value="${brightness}">
      </label>
      <button type="button" class="toolbar-button" data-command="auto-arrange">Auto arrange</button>
      <button type="button" class="toolbar-button" data-command="reset-view">Reset view</button>
      <button type="button" class="toolbar-button" data-command="reset-layout">Reset layout</button>
    `;

    options.toolbar.querySelector('[data-command="auto-arrange"]')?.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("nebula:auto-arrange"));
    });
    options.toolbar.querySelector('[data-command="reset-view"]')?.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("nebula:reset-view"));
    });
    options.toolbar.querySelector('[data-command="reset-layout"]')?.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("nebula:reset-layout"));
    });

    const slider = options.toolbar.querySelector<HTMLInputElement>('[data-control="brightness"]');
    slider?.addEventListener("input", () => {
      const value = parseFloat(slider.value);
      saveBrightness(value);
      options.onBrightnessChange(value);
    });

    const DOMAIN_ENTRIES: Array<[string, string, string]> = [
      ["todo",            "#4fd1c5", "Todos"],
      ["email",           "#8fb3ff", "Email"],
      ["person",          "#f5c76b", "People"],
      ["organization",    "#c77dff", "Orgs"],
      ["action-proposal", "#ff7a59", "Proposals"],
    ];

    const allDomains = DOMAIN_ENTRIES.map(([d]) => d);
    const visibleDomains = loadVisibleDomains(allDomains);

    options.legend.innerHTML = `
      <div class="legend-header">Node types</div>
      ${DOMAIN_ENTRIES.map(([domain, color, label]) => {
        const active = visibleDomains.has(domain);
        return `
          <button type="button" class="legend-toggle ${active ? "legend-toggle--on" : "legend-toggle--off"}"
            data-domain="${domain}" style="--swatch: ${color}">
            <span class="swatch"></span>
            <span>${label}</span>
          </button>
        `;
      }).join("")}
    `;

    options.legend.querySelectorAll<HTMLButtonElement>(".legend-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const domain = btn.dataset.domain ?? "";
        if (visibleDomains.has(domain)) {
          visibleDomains.delete(domain);
          btn.classList.replace("legend-toggle--on", "legend-toggle--off");
        } else {
          visibleDomains.add(domain);
          btn.classList.replace("legend-toggle--off", "legend-toggle--on");
        }
        saveVisibleDomains(visibleDomains);
        options.onVisibilityChange(new Set(visibleDomains));
      });
    });
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
      button.addEventListener("click", async () => {
        const actionId = button.dataset.action as ActionId;
        const nodeId = button.dataset.nodeId;
        if (!nodeId) return;

        button.disabled = true;
        const updatedScene = await options.actionService.execute(actionId, nodeId);
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

  const renderNodeGroup = (nodes: GraphNode[]): void => {
    const domains = new Set(nodes.map((node) => node.domain));
    options.inspector.innerHTML = `
      <div class="eyebrow">Node group</div>
      <h1 class="title">${nodes.length} selected</h1>
      <p class="summary">${nodes.map((node) => node.label).join(", ")}</p>
      ${fields([
        ["Domains", Array.from(domains).join(", ")],
        ["Statuses", Array.from(new Set(nodes.map((node) => node.status))).join(", ")],
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

// ---------------------------------------------------------------------------
// Field extraction — one branch per domain type
// ---------------------------------------------------------------------------

function nodeFields(node: GraphNode): Array<[string, string]> {
  const shared: Array<[string, string]> = [
    ["Status", node.status],
    ["Source", `${node.source.system}:${node.source.externalId}`],
  ];

  if (node.domain === "todo") {
    const todo = node as TodoNode;
    return [
      ["Title", todo.title],
      ["Priority", todo.priority],
      ["Due", todo.dueDate ? formatDate(todo.dueDate) : "Unscheduled"],
      ["Todo status", todo.todoStatus],
      ["Review", todo.reviewStatus || "—"],
      ["Confidence", todo.confidence != null ? `${Math.round(todo.confidence * 100)}%` : "—"],
      ...shared,
    ];
  }

  if (node.domain === "email") {
    const email = node as EmailNode;
    return [
      ["Sender", email.senderName ? `${email.senderName} <${email.sender}>` : email.sender],
      ["Subject", email.subject],
      ["Received", formatDate(email.timestamp)],
      ["Unread", email.unread ? "Yes" : "No"],
      ["Thread", email.threadId ?? "—"],
      ...shared,
    ];
  }

  if (node.domain === "person") {
    const person = node as PersonNode;
    return [
      ["Name", person.displayName],
      ["Email", person.primaryEmail ?? "—"],
      ["Org", person.organization ?? "—"],
      ...shared,
    ];
  }

  if (node.domain === "organization") {
    const org = node as OrganizationNode;
    return [
      ["Name", org.orgName],
      ["Domain", org.domain_name ?? "—"],
      ...shared,
    ];
  }

  if (node.domain === "action-proposal") {
    const proposal = node as ActionProposalNode;
    return [
      ["Proposal", proposal.proposalTitle],
      ["Risk", proposal.riskLevel ?? "—"],
      ["Proposal status", proposal.proposalStatus],
      ["Confidence", proposal.confidence != null ? `${Math.round(proposal.confidence * 100)}%` : "—"],
      ...shared,
    ];
  }

  return shared;
}

function summaryForNode(node: GraphNode): string {
  if (node.domain === "todo") return (node as TodoNode).title;
  if (node.domain === "email") return (node as EmailNode).subject;
  if (node.domain === "person") return (node as PersonNode).primaryEmail ?? (node as PersonNode).displayName;
  if (node.domain === "organization") return (node as OrganizationNode).domain_name ?? (node as OrganizationNode).orgName;
  if (node.domain === "action-proposal") return (node as ActionProposalNode).proposalTitle;
  return (node as BaseNode).label;
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

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
