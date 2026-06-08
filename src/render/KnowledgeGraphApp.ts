import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Plane } from "@babylonjs/core/Maths/math.plane";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import type { ActionService } from "../services/actionService";
import type { GraphSceneData, Selection } from "../domain/types";
import { GraphRenderer } from "./GraphRenderer";
import "@babylonjs/core/Culling/ray";

interface KnowledgeGraphAppOptions {
  canvas: HTMLCanvasElement;
  graphScene: GraphSceneData;
  actionService: ActionService;
  onSelectionChange: (selection: Selection) => void;
}

interface NodeDragState {
  nodeIds: string[];
  plane: Plane;
  lastPoint: Vector3;
}

interface BoxSelectState {
  startX: number;
  startY: number;
}

export class KnowledgeGraphApp {
  private engine: Engine;

  private scene: Scene;

  private camera: ArcRotateCamera;

  private renderer: GraphRenderer;

  private selection: Selection = null;

  private nodeDrag: NodeDragState | null = null;

  private boxSelect: BoxSelectState | null = null;

  private selectionBox: HTMLDivElement;

  constructor(private options: KnowledgeGraphAppOptions) {
    this.engine = new Engine(options.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
    });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.02, 0.025, 0.04, 1);
    this.camera = this.createCamera(options.canvas);
    this.createLightingAndPostProcessing();
    this.renderer = new GraphRenderer(this.scene);
    this.renderer.render(options.graphScene);
    this.selectionBox = this.createSelectionBox();
    this.bindPointerControls();
    this.bindGlobalControls();
    window.addEventListener("resize", this.resize);
  }

  start(): void {
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });
  }

  updateScene(graphScene: GraphSceneData): void {
    this.renderer.render(graphScene);
    this.selection = null;
    this.options.onSelectionChange(null);
  }

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("nebula:auto-arrange", this.autoArrange);
    window.removeEventListener("nebula:reset-layout", this.resetLayout);
    window.removeEventListener("nebula:reset-view", this.resetView);
    this.renderer.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  private createCamera(canvas: HTMLCanvasElement): ArcRotateCamera {
    const camera = new ArcRotateCamera("camera", -Math.PI / 2.2, Math.PI / 2.55, 16, Vector3.Zero(), this.scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 5;
    camera.upperRadiusLimit = 34;
    camera.wheelDeltaPercentage = 0.018;
    camera.panningSensibility = 65;
    camera.minZ = 0.1;
    return camera;
  }

  private resetCamera(bounds = this.renderer.getLayoutBounds()): void {
    this.camera.alpha = -Math.PI / 2.2;
    this.camera.beta = Math.PI / 2.55;
    this.camera.radius = Math.max(12, (bounds?.radius ?? 7) * 2.35);
    this.camera.target = bounds?.center ?? Vector3.Zero();
  }

  private createLightingAndPostProcessing(): void {
    const hemi = new HemisphericLight("soft-sky", new Vector3(0.2, 1, 0.4), this.scene);
    hemi.intensity = 0.65;

    const key = new DirectionalLight("key-light", new Vector3(-0.35, -0.8, -0.45), this.scene);
    key.position = new Vector3(8, 12, 8);
    key.intensity = 1.4;

    const glow = new GlowLayer("node-glow", this.scene);
    glow.intensity = 0.74;
    glow.blurKernelSize = 48;

    const pipeline = new DefaultRenderingPipeline("render-pipeline", true, this.scene, [this.camera]);
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.22;
    pipeline.bloomWeight = 0.38;
    pipeline.fxaaEnabled = true;
    pipeline.imageProcessing.contrast = 1.14;
    pipeline.imageProcessing.exposure = 1.02;
    pipeline.grainEnabled = true;
    pipeline.grain.intensity = 4;
  }

  private bindPointerControls(): void {
    this.scene.onPointerObservable.add((event) => {
      if (event.type === PointerEventTypes.POINTERDOWN) {
        this.handlePointerDown(event);
      }

      if (event.type === PointerEventTypes.POINTERMOVE) {
        this.handlePointerMove(event);
      }

      if (event.type === PointerEventTypes.POINTERUP) {
        this.handlePointerUp();
      }
    });
  }

  private handlePointerDown(event: PointerInfo): void {
    const pointerEvent = event.event as PointerEvent;
    if (pointerEvent.button !== 0) {
      return;
    }

    const selection = this.renderer.resolveSelection(event.pickInfo?.pickedMesh ?? null);
    if (!selection && pointerEvent.shiftKey) {
      this.startBoxSelect(pointerEvent);
      return;
    }

    if (!selection) {
      this.setSelection(null);
      return;
    }

    const selectedNodeIds = this.nodeIdsForDragSelection(selection);
    const selectionToApply =
      selection.type === "node" && selectedNodeIds.length > 1
        ? this.renderer.selectionForNodeIds(selectedNodeIds)
        : selection;
    this.setSelection(selectionToApply);

    if (selectedNodeIds.length === 0) {
      return;
    }

    const center = this.renderer.getNodeCenter(selectedNodeIds);
    if (!center) {
      return;
    }

    const plane = Plane.FromPositionAndNormal(center, this.camera.getForwardRay().direction);
    const startPoint = this.pointOnPlane(plane);
    if (!startPoint) {
      return;
    }

    this.camera.detachControl();
    this.nodeDrag = { nodeIds: selectedNodeIds, plane, lastPoint: startPoint };
  }

  private handlePointerMove(event: PointerInfo): void {
    if (this.nodeDrag) {
      const nextPoint = this.pointOnPlane(this.nodeDrag.plane);
      if (!nextPoint) {
        return;
      }

      const delta = nextPoint.subtract(this.nodeDrag.lastPoint);
      this.renderer.moveNodes(this.nodeDrag.nodeIds, delta);
      this.nodeDrag.lastPoint = nextPoint;
      return;
    }

    if (this.boxSelect) {
      const pointerEvent = event.event as PointerEvent;
      this.updateSelectionBox(pointerEvent.clientX, pointerEvent.clientY);
    }
  }

  private handlePointerUp(): void {
    if (this.nodeDrag) {
      this.nodeDrag = null;
      this.camera.attachControl(this.options.canvas, true);
      return;
    }

    if (!this.boxSelect) {
      return;
    }

    const rect = this.selectionBox.getBoundingClientRect();
    const selectedNodeIds = this.boxArea(rect) > 120 ? this.renderer.getNodeIdsInScreenRect(rect, this.options.canvas) : [];
    this.hideSelectionBox();
    this.boxSelect = null;
    this.camera.attachControl(this.options.canvas, true);
    this.setSelection(this.renderer.selectionForNodeIds(selectedNodeIds));
  }

  private setSelection(selection: Selection): void {
    this.selection = selection;
    this.renderer.applySelection(selection);
    this.options.onSelectionChange(selection);
  }

  private nodeIdsForDragSelection(selection: Selection): string[] {
    if (!selection) {
      return [];
    }

    if (selection.type === "edge") {
      return this.renderer.nodeIdsForEdge(selection.edge.id);
    }

    if (selection.type === "node") {
      const currentNodeIds = this.renderer.nodeIdsForSelection(this.selection);
      return currentNodeIds.includes(selection.node.id) ? currentNodeIds : [selection.node.id];
    }

    return this.renderer.nodeIdsForSelection(selection);
  }

  private pointOnPlane(plane: Plane): Vector3 | null {
    const ray = this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, Matrix.Identity(), this.camera);
    const distance = ray.intersectsPlane(plane);
    return distance === null ? null : ray.origin.add(ray.direction.scale(distance));
  }

  private startBoxSelect(pointerEvent: PointerEvent): void {
    this.camera.detachControl();
    this.boxSelect = { startX: pointerEvent.clientX, startY: pointerEvent.clientY };
    this.selectionBox.style.display = "block";
    this.updateSelectionBox(pointerEvent.clientX, pointerEvent.clientY);
  }

  private updateSelectionBox(currentX: number, currentY: number): void {
    if (!this.boxSelect) {
      return;
    }

    const canvasRect = this.options.canvas.getBoundingClientRect();
    const left = Math.min(this.boxSelect.startX, currentX);
    const top = Math.min(this.boxSelect.startY, currentY);
    const width = Math.abs(currentX - this.boxSelect.startX);
    const height = Math.abs(currentY - this.boxSelect.startY);

    this.selectionBox.style.left = `${left - canvasRect.left}px`;
    this.selectionBox.style.top = `${top - canvasRect.top}px`;
    this.selectionBox.style.width = `${width}px`;
    this.selectionBox.style.height = `${height}px`;
  }

  private hideSelectionBox(): void {
    this.selectionBox.style.display = "none";
    this.selectionBox.style.width = "0";
    this.selectionBox.style.height = "0";
  }

  private boxArea(rect: DOMRect): number {
    return rect.width * rect.height;
  }

  private createSelectionBox(): HTMLDivElement {
    const selectionBox = document.createElement("div");
    selectionBox.className = "selection-box";
    selectionBox.setAttribute("aria-hidden", "true");
    this.options.canvas.parentElement?.append(selectionBox);
    return selectionBox;
  }

  private bindGlobalControls(): void {
    window.addEventListener("nebula:auto-arrange", this.autoArrange);
    window.addEventListener("nebula:reset-layout", this.resetLayout);
    window.addEventListener("nebula:reset-view", this.resetView);
  }

  private autoArrange = (): void => {
    const result = this.renderer.autoArrange(this.selection);
    if (result === "all") {
      this.resetCamera(this.renderer.getLayoutBounds());
    }
  };

  private resetLayout = (): void => {
    this.renderer.resetLayout();
    this.resetCamera(this.renderer.getLayoutBounds());
    this.setSelection(null);
  };

  private resetView = (): void => {
    this.resetCamera();
  };

  private resize = (): void => {
    this.engine.resize();
  };
}
