import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Plane } from "@babylonjs/core/Maths/math.plane";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Engine } from "@babylonjs/core/Engines/engine";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MirrorTexture } from "@babylonjs/core/Materials/Textures/mirrorTexture";
import { NoiseProceduralTexture } from "@babylonjs/core/Materials/Textures/Procedurals/noiseProceduralTexture";
import { Scene } from "@babylonjs/core/scene";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import type { ActionService } from "../services/actionService";
import type { GraphSceneData, Selection } from "../domain/types";
import type { NodePositionMap } from "../services/layoutPersistence";
import { GraphRenderer } from "./GraphRenderer";
import {
  CAMERA_FLOOR_TARGET_CLEARANCE,
  REFLECTIVE_FLOOR_DEPTH,
  REFLECTIVE_FLOOR_WIDTH,
  REFLECTIVE_FLOOR_Y,
} from "./sceneBounds";
import "@babylonjs/core/Culling/ray";

interface KnowledgeGraphAppOptions {
  canvas: HTMLCanvasElement;
  graphScene: GraphSceneData;
  actionService: ActionService;
  onSelectionChange: (selection: Selection) => void;
  onLayoutChange?: (positions: NodePositionMap) => void;
  onLayoutReset?: () => void;
}

interface NodeDragState {
  nodeIds: string[];
  plane: Plane;
  lastPoint: Vector3;
  moved: boolean;
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
    this.scene.clearColor = new Color4(0.002, 0.003, 0.006, 1);
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
    camera.lowerBetaLimit = 0.18;
    camera.upperBetaLimit = Math.PI / 2.08;
    camera.lowerTargetYLimit = REFLECTIVE_FLOOR_Y + CAMERA_FLOOR_TARGET_CLEARANCE;
    camera.allowUpsideDown = false;
    camera.wheelDeltaPercentage = 0.018;
    camera.panningSensibility = 65;
    camera.minZ = 0.1;
    return camera;
  }

  private resetCamera(bounds = this.renderer.getLayoutBounds()): void {
    this.camera.alpha = -Math.PI / 2.2;
    this.camera.beta = Math.PI / 2.55;
    this.camera.radius = Math.max(12, (bounds?.radius ?? 7) * 2.35);
    this.camera.target = constrainCameraTarget(bounds?.center ?? Vector3.Zero());
  }

  private createLightingAndPostProcessing(): void {
    this.createReflectiveFloor();

    const glow = new GlowLayer("node-glow", this.scene);
    glow.intensity = 0.98;
    glow.blurKernelSize = 64;

    const pipeline = new DefaultRenderingPipeline("render-pipeline", true, this.scene, [this.camera]);
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.14;
    pipeline.bloomWeight = 0.52;
    pipeline.fxaaEnabled = true;
    pipeline.imageProcessing.contrast = 1.2;
    pipeline.imageProcessing.exposure = 1.04;
    pipeline.grainEnabled = true;
    pipeline.grain.intensity = 2.8;
  }

  private createReflectiveFloor(): void {
    const floorY = REFLECTIVE_FLOOR_Y;
    const floor = MeshBuilder.CreateGround(
      "reflection-floor",
      { width: REFLECTIVE_FLOOR_WIDTH, height: REFLECTIVE_FLOOR_DEPTH, subdivisions: 2 },
      this.scene,
    );
    const material = new StandardMaterial("reflection-floor-material", this.scene);
    const mirror = new MirrorTexture("reflection-floor-mirror", { ratio: 0.82 }, this.scene, true);
    const surfaceNoise = new NoiseProceduralTexture("reflection-floor-surface-noise", 256, this.scene);

    floor.position.y = floorY;
    floor.isPickable = false;
    mirror.mirrorPlane = new Plane(0, -1, 0, floorY);
    mirror.renderListPredicate = (mesh: AbstractMesh) =>
      mesh.name !== floor.name && mesh.isVisible && mesh.isEnabled(false);
    mirror.renderParticles = true;
    mirror.adaptiveBlurKernel = 20;
    mirror.level = 0.5;
    surfaceNoise.brightness = 0.08;
    surfaceNoise.octaves = 5;
    surfaceNoise.persistence = 0.68;
    surfaceNoise.animationSpeedFactor = 0;
    surfaceNoise.uScale = 11;
    surfaceNoise.vScale = 7;
    surfaceNoise.level = 0.04;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.FromHexString("#38465d");
    material.emissiveColor = Color3.FromHexString("#010309");
    material.bumpTexture = surfaceNoise;
    material.emissiveTexture = surfaceNoise;
    material.specularTexture = surfaceNoise;
    material.reflectionTexture = mirror;
    material.roughness = 0.38;
    material.specularPower = 22;
    material.alpha = 1;
    floor.material = material;
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
    this.nodeDrag = { nodeIds: selectedNodeIds, plane, lastPoint: startPoint, moved: false };
  }

  private handlePointerMove(event: PointerInfo): void {
    if (this.nodeDrag) {
      const nextPoint = this.pointOnPlane(this.nodeDrag.plane);
      if (!nextPoint) {
        return;
      }

      const delta = nextPoint.subtract(this.nodeDrag.lastPoint);
      this.nodeDrag.moved = this.renderer.moveNodes(this.nodeDrag.nodeIds, delta) || this.nodeDrag.moved;
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
      if (this.nodeDrag.moved) {
        this.persistLayout();
      }
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
    if (result !== "none") {
      this.persistLayout();
    }
  };

  private resetLayout = (): void => {
    this.options.onLayoutReset?.();
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

  private persistLayout(): void {
    this.options.onLayoutChange?.(this.renderer.getNodePositions());
  }
}

function constrainCameraTarget(target: Vector3): Vector3 {
  const constrained = target.clone();
  constrained.y = Math.max(constrained.y, REFLECTIVE_FLOOR_Y + CAMERA_FLOOR_TARGET_CLEARANCE);
  return constrained;
}
