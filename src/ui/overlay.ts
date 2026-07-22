import type { ActionService } from "../services/actionService";
import type {
  ActionId,
  BaseNode,
  GraphSceneData,
  GraphNode,
  Selection,
  PersonNode,
  OrganizationNode,
  MemoryLikeNode,
  TaskNode,
  MessageNode,
  DocumentNode,
  MeetingNode,
  IssueNode,
  MergeRequestNode,
  CommitNode,
  ProjectNode,
  JiraProjectNode,
  ConfluenceSpaceNode,
  FigmaTeamNode,
  FigmaProjectNode,
  ChannelNode,
  RepoNode,
  UnknownNode,
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
      // Memory kinds
      ["memory",            "#f6a5c0", "Memory"],
      ["decision",          "#e05780", "Decisions"],
      ["spec",              "#b28dff", "Specs"],
      ["preference",        "#ffb86b", "Preferences"],
      ["task",              "#4fd1c5", "Tasks"],
      ["retro",             "#ff7a59", "Retros"],
      // Content
      ["message",           "#8fb3ff", "Messages"],
      ["document",          "#78d8b0", "Documents"],
      ["meeting",           "#f7d060", "Meetings"],
      // People
      ["person",            "#f5c76b", "People"],
      ["organization",      "#c77dff", "Orgs"],
      // Work
      ["issue",             "#58a6ff", "Issues"],
      ["merge-request",     "#a371f7", "MRs"],
      ["commit",            "#7c8db5", "Commits"],
      // Containers
      ["project",           "#7dd87d", "Projects"],
      ["jira-project",      "#3388dd", "Jira projects"],
      ["confluence-space",  "#4aa1c8", "Confluence"],
      ["figma-team",        "#ff5e5b", "Figma teams"],
      ["figma-project",     "#ff8fa3", "Figma projects"],
      ["channel",           "#63c5da", "Channels"],
      ["repo",              "#9ba6b2", "Repos"],
      // Catch-all for labels the wayfinder hasn't been taught yet.
      ["unknown",           "#a0a0a0", "Unknown"],
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

  if (node.domain === "person") {
    const person = node as PersonNode;
    const handles = person.handles
      ? Object.entries(person.handles).map(([k, v]) => `${k}=${v}`).join(", ")
      : "—";
    return [
      ["Name", person.displayName],
      ["Email", person.primaryEmail ?? "—"],
      ["Kind", person.kind ?? "—"],
      ["Handles", handles],
      ...shared,
    ];
  }

  if (node.domain === "organization") {
    const org = node as OrganizationNode;
    return [
      ["Name", org.orgName],
      ["Domain", org.domain_name ?? "—"],
      ["Kind", org.kind ?? "—"],
      ...shared,
    ];
  }

  if (
    node.domain === "memory" || node.domain === "decision" ||
    node.domain === "spec" || node.domain === "preference" ||
    node.domain === "retro"
  ) {
    const m = node as MemoryLikeNode;
    return [
      ["Kind", m.kindLabel ?? node.domain],
      ["Content", m.content],
      ...(m.signalType ? [["Signal", m.signalType] as [string, string]] : []),
      ...(m.reconciliationStatus ? [["Reconciliation", m.reconciliationStatus] as [string, string]] : []),
      ...shared,
    ];
  }

  if (node.domain === "task") {
    const t = node as TaskNode;
    return [
      ["Title", t.title],
      ["Priority", t.priority ?? "—"],
      ["Task status", t.taskStatus ?? "—"],
      ["Assignee", t.assignee ?? "—"],
      ["Due", t.dueAt ? formatDate(t.dueAt) : "Unscheduled"],
      ...(t.notBefore ? [["Not before", formatDate(t.notBefore)] as [string, string]] : []),
      ["Confidence", t.confidence != null ? `${Math.round(t.confidence * 100)}%` : "—"],
      ...(t.details ? [["Details", t.details] as [string, string]] : []),
      ...shared,
    ];
  }

  if (node.domain === "message") {
    const m = node as MessageNode;
    return [
      ["Subject", m.subject ?? "—"],
      ["From", m.fromEmail ?? "—"],
      ["Timestamp", m.timestamp ? formatDate(m.timestamp) : "—"],
      ["Channel", m.channelName ?? "—"],
      ["Thread", m.threadId ?? "—"],
      ...(m.labels?.length ? [["Labels", m.labels.join(", ")] as [string, string]] : []),
      ...(m.content ? [["Content", m.content] as [string, string]] : []),
      ...shared,
    ];
  }

  if (node.domain === "document") {
    const d = node as DocumentNode;
    return [
      ["Title", d.title],
      ["Kind", d.kind ?? "—"],
      ["Space", d.spaceKey ?? "—"],
      ["Modified", d.lastModified ? formatDate(d.lastModified) : "—"],
      ["URL", d.webUrl ?? "—"],
      ...shared,
    ];
  }

  if (node.domain === "meeting") {
    const m = node as MeetingNode;
    return [
      ["Topic", m.topic],
      ["Start", m.startTime ? formatDate(m.startTime) : "—"],
      ["Duration", m.durationSec != null ? `${Math.round(m.durationSec / 60)} min` : "—"],
      ["URL", m.shareUrl ?? "—"],
      ...shared,
    ];
  }

  if (node.domain === "issue") {
    const i = node as IssueNode;
    return [
      ["Key", i.key],
      ["Summary", i.summary],
      ["Type", i.issueType ?? "—"],
      ["Status", i.issueStatus ?? i.status],
      ["Priority", i.priority ?? "—"],
      ["Project", i.projectKey ?? "—"],
      ["Updated", i.updatedAt ? formatDate(i.updatedAt) : "—"],
      ["URL", i.webUrl ?? "—"],
      ...(i.labels?.length ? [["Labels", i.labels.join(", ")] as [string, string]] : []),
      ...shared,
    ];
  }

  if (node.domain === "merge-request") {
    const mr = node as MergeRequestNode;
    return [
      ["Key", mr.key],
      ["Title", mr.title],
      ["State", mr.state ?? "—"],
      ["Source", mr.sourceBranch ?? "—"],
      ["Target", mr.targetBranch ?? "—"],
      ["Project", mr.projectPath ?? "—"],
      ["URL", mr.webUrl ?? "—"],
      ...shared,
    ];
  }

  if (node.domain === "commit") {
    const c = node as CommitNode;
    return [
      ["SHA", c.shortSha],
      ["Project", c.projectPath ?? "—"],
      ["Timestamp", c.timestamp ? formatDate(c.timestamp) : "—"],
      ["URL", c.webUrl ?? "—"],
      ...(c.content ? [["Message", c.content] as [string, string]] : []),
      ...shared,
    ];
  }

  if (node.domain === "project") {
    const p = node as ProjectNode;
    return [["Name", p.projectName], ["Key", p.projectKey ?? "—"], ...shared];
  }

  if (node.domain === "jira-project") {
    const p = node as JiraProjectNode;
    return [
      ["Name", p.projectName],
      ["Key", p.jiraProjectKey ?? "—"],
      ...(p.description ? [["Description", p.description] as [string, string]] : []),
      ...shared,
    ];
  }

  if (node.domain === "confluence-space") {
    const s = node as ConfluenceSpaceNode;
    return [
      ["Name", s.spaceName],
      ["Key", s.spaceKey ?? "—"],
      ...(s.description ? [["Description", s.description] as [string, string]] : []),
      ...shared,
    ];
  }

  if (node.domain === "figma-team") {
    const t = node as FigmaTeamNode;
    return [["Name", t.teamName], ["Key", t.teamKey ?? "—"], ...shared];
  }

  if (node.domain === "figma-project") {
    const p = node as FigmaProjectNode;
    return [["Name", p.projectName], ["Key", p.projectKey ?? "—"], ...shared];
  }

  if (node.domain === "channel") {
    const c = node as ChannelNode;
    return [
      ["Name", c.channelName],
      ["Private", c.isPrivate ? "Yes" : "No"],
      ["Type", c.channelType ?? "—"],
      ...(c.topic ? [["Topic", c.topic] as [string, string]] : []),
      ...shared,
    ];
  }

  if (node.domain === "repo") {
    const r = node as RepoNode;
    return [
      ["Name", r.repoName],
      ["Default branch", r.defaultBranch ?? "—"],
      ["URL", r.webUrl ?? "—"],
      ...(r.description ? [["Description", r.description] as [string, string]] : []),
      ...shared,
    ];
  }

  if (node.domain === "unknown") {
    const u = node as UnknownNode;
    // Surface every property so a maintainer can see what a novel label
    // looks like from the outside before writing a first-class mapper.
    const propRows: Array<[string, string]> = Object.entries(u.rawProperties)
      .filter(([, v]) => v != null && String(v).length > 0)
      .slice(0, 12)
      .map(([k, v]) => [k, String(v).slice(0, 200)]);
    return [
      ["Label", u.primaryLabel],
      ["All labels", u.allLabels.join(", ")],
      ...propRows,
      ...shared,
    ];
  }

  return shared;
}

function summaryForNode(node: GraphNode): string {
  switch (node.domain) {
    case "person": return (node as PersonNode).primaryEmail ?? (node as PersonNode).displayName;
    case "organization": return (node as OrganizationNode).domain_name ?? (node as OrganizationNode).orgName;
    case "memory":
    case "decision":
    case "spec":
    case "preference":
    case "retro":
      return (node as MemoryLikeNode).content;
    case "task": return (node as TaskNode).title;
    case "message": return (node as MessageNode).subject ?? (node as MessageNode).content ?? node.label;
    case "document": return (node as DocumentNode).title;
    case "meeting": return (node as MeetingNode).topic;
    case "issue": return (node as IssueNode).summary;
    case "merge-request": return (node as MergeRequestNode).title;
    case "commit": return (node as CommitNode).content ?? (node as CommitNode).shortSha;
    case "project": return (node as ProjectNode).projectName;
    case "jira-project": return (node as JiraProjectNode).projectName;
    case "confluence-space": return (node as ConfluenceSpaceNode).spaceName;
    case "figma-team": return (node as FigmaTeamNode).teamName;
    case "figma-project": return (node as FigmaProjectNode).projectName;
    case "channel": return (node as ChannelNode).channelName;
    case "repo": return (node as RepoNode).repoName;
    case "unknown": {
      const u = node as UnknownNode;
      return u.displayValue ?? `${u.primaryLabel} node`;
    }
    default: return (node as BaseNode).label;
  }
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
