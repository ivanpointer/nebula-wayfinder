import { KnowledgeGraphApp } from "./render/KnowledgeGraphApp";
import { createOverlay, loadBrightness, loadVisibleDomains } from "./ui/overlay";
import { createActionService } from "./services/actionService";
import { fetchGraphScene } from "./services/graphService";
import { mockGraphScene } from "./data/mockGraphScene";
import {
  applyStoredNodePositions,
  clearStoredNodePositions,
  readStoredNodePositions,
  writeStoredNodePositions,
} from "./services/layoutPersistence";
import "./styles.css";

const canvas = document.querySelector<HTMLCanvasElement>("#renderCanvas");
const inspector = document.querySelector<HTMLElement>("#inspector");
const toolbar = document.querySelector<HTMLElement>("#toolbar");
const legend = document.querySelector<HTMLElement>("#legend");

if (!canvas || !inspector || !toolbar || !legend) {
  throw new Error("Nebula Wayfinder failed to find required DOM anchors.");
}

let graphScene = mockGraphScene;
try {
  graphScene = await fetchGraphScene();
} catch (err) {
  console.error("[nebula-wayfinder] Failed to fetch scene from Neo4j, falling back to mock:", err);
  // Surface the error visibly during dev so it's not silent
  const errBanner = document.createElement("div");
  errBanner.style.cssText = "position:fixed;top:0;left:0;right:0;background:#b00;color:#fff;font:13px monospace;padding:8px 12px;z-index:9999;white-space:pre-wrap;word-break:break-all;";
  errBanner.textContent = `Neo4j error: ${err instanceof Error ? err.message : String(err)}`;
  document.body.appendChild(errBanner);
}

const actionService = createActionService(graphScene);

const app = new KnowledgeGraphApp({
  canvas,
  graphScene: applyStoredNodePositions(graphScene, readStoredNodePositions()),
  actionService,
  onSelectionChange: (sel) => overlay.renderSelection(sel),
  onLayoutChange: writeStoredNodePositions,
  onLayoutReset: clearStoredNodePositions,
});

const overlay = createOverlay({
  inspector,
  toolbar,
  legend,
  graphScene,
  actionService,
  onBrightnessChange: (value) => app.setBrightness(value),
  onVisibilityChange: (visible) => app.setVisibleDomains(visible),
});

overlay.onActionResult((updatedScene) => app.updateScene(applyStoredNodePositions(updatedScene, readStoredNodePositions())));
app.start();

// Apply persisted brightness and visibility after the pipeline is ready.
app.setBrightness(loadBrightness());
// Must match the NodeDomain union in src/domain/types.ts. Keep this in sync
// with DOMAIN_ENTRIES in src/ui/overlay.ts — both drive first-run visibility.
const allDomains: string[] = [
  "person", "organization",
  "memory", "decision", "spec", "preference", "task", "retro",
  "message", "document", "meeting",
  "issue", "merge-request", "commit",
  "project", "jira-project", "confluence-space",
  "figma-team", "figma-project", "channel", "repo",
  "unknown",
];
app.setVisibleDomains(loadVisibleDomains(allDomains));
