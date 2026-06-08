import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
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

interface KnowledgeGraphAppOptions {
  canvas: HTMLCanvasElement;
  graphScene: GraphSceneData;
  actionService: ActionService;
  onSelectionChange: (selection: Selection) => void;
}

export class KnowledgeGraphApp {
  private engine: Engine;

  private scene: Scene;

  private camera: ArcRotateCamera;

  private renderer: GraphRenderer;

  private selection: Selection = null;

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
    this.bindPicking();
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

  private bindPicking(): void {
    this.scene.onPointerObservable.add((event) => {
      if (event.type !== PointerEventTypes.POINTERPICK) {
        return;
      }

      const selection = this.renderer.resolveSelection(event.pickInfo?.pickedMesh ?? null);
      this.selection = selection;
      this.renderer.applySelection(selection);
      this.options.onSelectionChange(selection);
    });
  }

  private resize = (): void => {
    this.engine.resize();
  };
}
