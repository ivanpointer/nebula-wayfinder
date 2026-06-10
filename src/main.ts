import { KnowledgeGraphApp } from "./render/KnowledgeGraphApp";
import { createOverlay } from "./ui/overlay";
import { createActionService } from "./services/actionService";
import { fetchGraphScene } from "./services/graphService";
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

const graphScene = await fetchGraphScene();
const actionService = createActionService(graphScene);
const overlay = createOverlay({ inspector, toolbar, legend, graphScene, actionService });

const app = new KnowledgeGraphApp({
  canvas,
  graphScene: applyStoredNodePositions(graphScene, readStoredNodePositions()),
  actionService,
  onSelectionChange: overlay.renderSelection,
  onLayoutChange: writeStoredNodePositions,
  onLayoutReset: clearStoredNodePositions,
});

overlay.onActionResult((updatedScene) => app.updateScene(applyStoredNodePositions(updatedScene, readStoredNodePositions())));
app.start();
