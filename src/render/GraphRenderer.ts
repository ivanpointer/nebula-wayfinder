import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { makeEdgeCurve, pointBeforeTarget, toVector3 } from "../graph/edgeCurves";
import { arrangeNodes, layoutGraphClouds, type PositionedNode } from "../graph/layout";
import type { GraphEdge, GraphNode, GraphSceneData, Selection, VectorTuple } from "../domain/types";
import { clearFixedNodePositions, type NodePositionMap } from "../services/layoutPersistence";
import { createEdgeArrowMaterial, createEdgeGlowMaterial, createEdgeMaterial, createNodeMaterial, nodeColorForRender } from "./materials";
import { NODE_FLOOR_CLEARANCE, REFLECTIVE_FLOOR_Y } from "./sceneBounds";

interface RenderedNode {
  graphId: string;
  node: GraphNode;
  root: TransformNode;
  visualRoot: TransformNode;
  mesh: Mesh;
  core: Mesh;
  position: Vector3;
  connectionRadius: number;
  color: Color3;
  idlePhase: number;
  selectionScale: number;
  fire?: ParticleSystem;
}

interface RenderedEdge {
  graphId: string;
  edge: GraphEdge;
  mesh: Mesh;
  glow: Mesh;
  glowMaterial: StandardMaterial;
  arrow?: Mesh;
  flow?: Mesh;
  flowMaterial?: StandardMaterial;
  path: Vector3[];
  color: Color3;
  flowPhase: number;
}

export type GraphVisualEventType = "created" | "deleted" | "state-change" | "movement" | "selection";

export interface GraphVisualEvent {
  type: GraphVisualEventType;
  nodeIds?: string[];
  edgeIds?: string[];
  intensity?: number;
}

interface NodeTransition {
  nodeId: string;
  from: Vector3;
  to: Vector3;
  startedAt: number;
  duration: number;
}

interface HaloEffect {
  type: "halo";
  mesh: Mesh;
  material: StandardMaterial;
  startedAt: number;
  duration: number;
  intensity: number;
}

interface EdgePulseEffect {
  type: "edge-pulse";
  mesh: Mesh;
  material: StandardMaterial;
  path: Vector3[];
  startedAt: number;
  duration: number;
  intensity: number;
}

type VisualEffect = HaloEffect | EdgePulseEffect;

interface SceneSnapshot {
  nodes: Map<string, GraphNode>;
  edges: Set<string>;
  positions: Map<string, Vector3>;
}

export class GraphRenderer {
  private root: TransformNode;

  private effectsRoot: TransformNode;

  private nodes = new Map<string, RenderedNode>();

  private edges = new Map<string, RenderedEdge>();

  private nodePositions = new Map<string, Vector3>();

  private sceneData: GraphSceneData | null = null;

  private selected: Selection = null;

  private transitions = new Map<string, NodeTransition>();

  private effects: VisualEffect[] = [];

  private fireTexture: Texture | null = null;

  private animationObserver: Observer<Scene>;

  private lastMovementEffectAt = 0;

  constructor(private scene: Scene) {
    this.root = new TransformNode("graph-root", scene);
    this.effectsRoot = new TransformNode("graph-effects-root", scene);
    this.animationObserver = scene.onBeforeRenderObservable.add(() => this.animate());
  }

  render(sceneData: GraphSceneData): void {
    const previous = this.captureSnapshot();
    this.sceneData = sceneData;
    this.disposeGraph();
    this.root = new TransformNode("graph-root", this.scene);
    const positionedNodes = layoutGraphClouds(sceneData.graphs);
    const positionByNodeId = new Map(positionedNodes.map((item) => [item.node.id, item]));

    positionedNodes.forEach((positioned) => this.createNode(positioned));

    sceneData.graphs.forEach((graph) => {
      graph.edges.forEach((edge) => {
        const source = positionByNodeId.get(edge.source);
        const target = positionByNodeId.get(edge.target);
        if (source && target) {
          this.createEdge(graph.id, edge, source, target);
        }
      });
    });

    this.playSceneDiff(previous);
  }

  setVisibleDomains(visible: Set<string>): void {
    // Track which node IDs are visible so edges can follow.
    const visibleNodeIds = new Set<string>();

    this.nodes.forEach((rendered) => {
      const show = visible.has(rendered.node.domain);
      rendered.mesh.setEnabled(show);
      rendered.core.setEnabled(show);
      rendered.mesh.isPickable = show;
      rendered.core.isPickable = show;
      if (rendered.fire) {
        show ? rendered.fire.start() : rendered.fire.stop();
      }
      if (show) visibleNodeIds.add(rendered.node.id);
    });

    this.edges.forEach((rendered) => {
      const show = visibleNodeIds.has(rendered.edge.source) && visibleNodeIds.has(rendered.edge.target);
      rendered.mesh.setEnabled(show);
      rendered.glow.setEnabled(show);
      rendered.arrow?.setEnabled(show);
      rendered.flow?.setEnabled(show);
    });
  }

  resetLayout(): void {
    if (!this.sceneData) {
      return;
    }

    this.render(clearFixedNodePositions(this.sceneData));
    this.applySelection(null);
  }

  autoArrange(selection: Selection): "all" | "selection" | "none" {
    if (!selection) {
      this.arrangeAllNodes();
      return "all";
    }

    if (selection.type === "nodes" && selection.nodes.length > 1) {
      this.arrangeSelectedNodes(selection.nodes.map((node) => node.id));
      return "selection";
    }

    return "none";
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.animationObserver);
    this.disposeGraph();
    this.effects.forEach((effect) => effect.mesh.dispose(false, true));
    this.effects = [];
    this.fireTexture?.dispose();
    this.fireTexture = null;
    this.effectsRoot.dispose(false, true);
  }

  emitGraphEvent(event: GraphVisualEvent): void {
    const intensity = event.intensity ?? 1;
    event.nodeIds?.forEach((nodeId) => this.createNodeHalo(nodeId, event.type, intensity));
    event.edgeIds?.forEach((edgeId) => this.createEdgePulse(edgeId, event.type, intensity));
  }

  private disposeGraph(): void {
    this.nodes.forEach((node) => node.fire?.dispose(false));
    this.root.dispose(false, true);
    this.nodes.clear();
    this.edges.clear();
    this.nodePositions.clear();
    this.transitions.clear();
  }

  resolveSelection(mesh: AbstractMesh | null): Selection {
    if (!mesh) {
      return null;
    }

    const nodeId = mesh.metadata?.nodeId as string | undefined;
    const edgeId = mesh.metadata?.edgeId as string | undefined;

    if (nodeId) {
      const rendered = this.nodes.get(nodeId);
      return rendered ? { type: "node", graphId: rendered.graphId, node: rendered.node } : null;
    }

    if (edgeId) {
      const rendered = this.edges.get(edgeId);
      return rendered ? { type: "edge", graphId: rendered.graphId, edge: rendered.edge } : null;
    }

    return null;
  }

  applySelection(selection: Selection, emitEvent = true): void {
    this.selected = selection;
    const selectedNodeIds =
      selection?.type === "node"
        ? new Set([selection.node.id])
        : selection?.type === "nodes"
          ? new Set(selection.nodes.map((node) => node.id))
          : new Set<string>();
    const selectedEdgeId = selection?.type === "edge" ? selection.edge.id : undefined;
    const neighborIds = this.findNeighborNodeIds(selectedNodeIds);

    this.nodes.forEach((rendered) => {
      const isSelected = selectedNodeIds.has(rendered.node.id);
      const isNeighbor = neighborIds.has(rendered.node.id);
      rendered.selectionScale = isSelected ? 1.28 : isNeighbor ? 1.12 : 1;
      const visibility = !selection || isSelected || isNeighbor ? 1 : 0.42;
      rendered.mesh.visibility = visibility;
      rendered.core.visibility = visibility;
    });

    this.edges.forEach((rendered) => {
      const connectedToNode =
        selectedNodeIds.has(rendered.edge.source) || selectedNodeIds.has(rendered.edge.target);
      const isSelectedEdge = rendered.edge.id === selectedEdgeId;
      const visible = !selection || connectedToNode || isSelectedEdge;
      const visibility = visible ? 1 : 0.18;
      rendered.mesh.visibility = visibility;
      rendered.glow.visibility = visibility;
      rendered.glowMaterial.alpha = neonGlowAlpha(rendered.edge, isSelectedEdge) * visibility;
      if (rendered.arrow) {
        rendered.arrow.visibility = visibility;
      }
      if (rendered.flow) {
        rendered.flow.visibility = visibility;
      }
    });

    if (emitEvent) {
      this.emitGraphEvent({
        type: "selection",
        nodeIds: Array.from(selectedNodeIds),
        edgeIds: selectedEdgeId ? [selectedEdgeId] : [],
        intensity: 0.72,
      });
    }
  }

  getNodeIdsInScreenRect(rect: DOMRect, canvas: HTMLCanvasElement): string[] {
    const viewport = this.scene.activeCamera?.viewport.toGlobal(this.scene.getEngine().getRenderWidth(), this.scene.getEngine().getRenderHeight());
    const camera = this.scene.activeCamera;
    if (!camera || !viewport) {
      return [];
    }

    const canvasRect = canvas.getBoundingClientRect();
    const left = rect.left - canvasRect.left;
    const right = rect.right - canvasRect.left;
    const top = rect.top - canvasRect.top;
    const bottom = rect.bottom - canvasRect.top;
    const transform = camera.getTransformationMatrix();

    return Array.from(this.nodes.values())
      .filter((rendered) => {
        const projected = Vector3.Project(rendered.root.getAbsolutePosition(), Matrix.IdentityReadOnly, transform, viewport);
        return projected.x >= left && projected.x <= right && projected.y >= top && projected.y <= bottom;
      })
      .map((rendered) => rendered.node.id);
  }

  selectionForNodeIds(nodeIds: string[]): Selection {
    const nodes = nodeIds.map((id) => this.nodes.get(id)?.node).filter((node): node is GraphNode => Boolean(node));
    if (nodes.length === 0) {
      return null;
    }

    if (nodes.length === 1) {
      const rendered = this.nodes.get(nodes[0].id);
      return rendered ? { type: "node", graphId: rendered.graphId, node: nodes[0] } : null;
    }

    return { type: "nodes", nodes };
  }

  moveNodes(nodeIds: string[], delta: Vector3): boolean {
    if (nodeIds.length === 0 || delta.lengthSquared() === 0) {
      return false;
    }

    const movementDelta = this.constrainDragDelta(nodeIds, delta);
    if (movementDelta.lengthSquared() === 0) {
      return false;
    }

    nodeIds.forEach((nodeId) => {
      const rendered = this.nodes.get(nodeId);
      if (!rendered) {
        return;
      }

      this.transitions.delete(nodeId);
      this.setNodePosition(nodeId, rendered.root.position.add(movementDelta));
    });

    this.rebuildEdges();
    this.emitThrottledMovementEvent(nodeIds, 0.32);
    return true;
  }

  getNodeCenter(nodeIds: string[]): Vector3 | null {
    const positions = nodeIds
      .map((nodeId) => this.nodes.get(nodeId)?.root.position)
      .filter((position): position is Vector3 => Boolean(position));

    if (positions.length === 0) {
      return null;
    }

    return positions.reduce((sum, position) => sum.add(position), Vector3.Zero()).scale(1 / positions.length);
  }

  getLayoutBounds(): { center: Vector3; radius: number } | null {
    const positions = Array.from(this.nodes.values()).map((rendered) => rendered.root.position);
    if (positions.length === 0) {
      return null;
    }

    const center = positions.reduce((sum, position) => sum.add(position), Vector3.Zero()).scale(1 / positions.length);
    const radius = positions.reduce(
      (maxRadius, position) => Math.max(maxRadius, Vector3.Distance(center, position)),
      1,
    );
    return { center, radius };
  }

  getNodePositions(): NodePositionMap {
    return Object.fromEntries(
      Array.from(this.nodes.entries()).map(([nodeId, rendered]) => {
        const position = this.transitions.get(nodeId)?.to ?? rendered.root.position;
        return [nodeId, toVectorTuple(position)];
      }),
    );
  }

  nodeIdsForSelection(selection: Selection): string[] {
    if (selection?.type === "node") {
      return [selection.node.id];
    }

    if (selection?.type === "nodes") {
      return selection.nodes.map((node) => node.id);
    }

    return [];
  }

  nodeIdsForEdge(edgeId: string): string[] {
    const edge = this.edges.get(edgeId)?.edge;
    return edge ? [edge.source, edge.target] : [];
  }

  private createNode({ graphId, node, position }: PositionedNode): void {
    const root = new TransformNode(`node-root-${node.id}`, this.scene);
    root.parent = this.root;
    root.position = toVector3(position);

    const visualRoot = new TransformNode(`node-visual-${node.id}`, this.scene);
    visualRoot.parent = root;

    const sphere = MeshBuilder.CreateSphere(
      `node-${node.id}`,
      { diameter: node.domain === "retro" || node.domain === "decision" ? 1.04 : 0.86, segments: 32 },
      this.scene,
    );
    sphere.parent = visualRoot;
    sphere.material = createNodeMaterial(this.scene, node);
    sphere.metadata = { nodeId: node.id };

    const core = MeshBuilder.CreateSphere(`node-core-${node.id}`, { diameter: 0.34, segments: 16 }, this.scene);
    core.parent = visualRoot;
    core.material = createEdgeMaterial(this.scene, `core-${node.id}`, nodeColorForRender(node), true);
    core.metadata = { nodeId: node.id };
    const fire = this.createNodeFire(node, sphere);
    const connectionRadius = this.measureConnectionRadius(root);
    root.position.copyFrom(clampNodePosition(root.position, connectionRadius));
    this.nodePositions.set(node.id, root.position.clone());

    this.nodes.set(node.id, {
      graphId,
      node,
      root,
      visualRoot,
      mesh: sphere,
      core,
      position: root.position.clone(),
      connectionRadius,
      color: nodeColorForRender(node),
      idlePhase: seededPhase(node.id),
      selectionScale: 1,
      fire,
    });
  }

  private createEdge(
    graphId: string,
    edge: GraphEdge,
    source: PositionedNode,
    target: PositionedNode,
  ): void {
    this.createEdgeFromPositions(graphId, edge, toVector3(source.position), toVector3(target.position));
  }

  private createEdgeFromPositions(graphId: string, edge: GraphEdge, source: Vector3, target: Vector3): void {
    const color = edge.visual?.colorToken ? colorForToken(edge.visual.colorToken) : Color3.FromHexString("#9fb7c7");
    const points = makeEdgeCurve(source, target, edge.directed ? 1.9 : 1.45);
    const weight = edge.visual?.weight ?? 1;
    const coreRadius = Math.max(0.034, 0.042 * weight);
    const glowRadius = coreRadius * 2.45;
    const glow = MeshBuilder.CreateTube(
      `edge-glow-${edge.id}`,
      {
        path: points,
        radius: glowRadius,
        tessellation: 18,
        cap: Mesh.NO_CAP,
      },
      this.scene,
    );
    const tube = MeshBuilder.CreateTube(
      `edge-${edge.id}`,
      {
        path: points,
        radius: coreRadius,
        tessellation: 12,
        cap: Mesh.NO_CAP,
      },
      this.scene,
    );
    const glowMaterial = createEdgeGlowMaterial(this.scene, edge.id, color);
    glow.parent = this.root;
    glow.material = glowMaterial;
    glow.metadata = { edgeId: edge.id };
    glow.isPickable = false;
    tube.parent = this.root;
    tube.material = createEdgeMaterial(this.scene, edge.id, color);
    tube.metadata = { edgeId: edge.id };

    const arrow = edge.directed ? this.createArrow(edge, points, target, color) : undefined;
    const { flow, material: flowMaterial } = this.createEdgeFlow(edge, points, color);
    this.edges.set(edge.id, {
      graphId,
      edge,
      mesh: tube,
      glow,
      glowMaterial,
      arrow,
      flow,
      flowMaterial,
      path: points,
      color,
      flowPhase: seededPhase(edge.id),
    });
  }

  private createArrow(edge: GraphEdge, points: Vector3[], target: Vector3, color: Color3): Mesh {
    const targetRadius = this.getNodeConnectionRadius(edge.target);
    const tip = pointBeforeTarget(points, target, targetRadius * 0.9);
    const baseCenter = pointBeforeTarget(points, target, targetRadius + 0.3);
    const direction = tip.subtract(baseCenter).normalize();
    const upCandidate = Math.abs(Vector3.Dot(direction, Vector3.Up())) > 0.82 ? Vector3.Right() : Vector3.Up();
    const side = Vector3.Cross(direction, upCandidate).normalize();
    const wingLength = 0.24;
    const wingWidth = 0.13;
    const wingBase = tip.subtract(direction.scale(wingLength));
    const leftBase = wingBase.add(side.scale(wingWidth));
    const rightBase = wingBase.subtract(side.scale(wingWidth));
    const arrow = new Mesh(`edge-arrow-${edge.id}`, this.scene);
    const arrowMaterial = createEdgeArrowMaterial(this.scene, `arrow-${edge.id}`, color);
    arrow.parent = this.root;
    arrow.metadata = { edgeId: edge.id };

    [leftBase, rightBase].forEach((base, index) => {
      const wing = MeshBuilder.CreateTube(
        `edge-arrow-${edge.id}-wing-${index}`,
        {
          path: [base, tip],
          radius: 0.018,
          tessellation: 6,
          cap: Mesh.CAP_ALL,
        },
        this.scene,
      );
      wing.parent = arrow;
      wing.material = arrowMaterial;
      wing.metadata = { edgeId: edge.id };
    });

    return arrow;
  }

  private getNodeConnectionRadius(nodeId: string): number {
    return this.nodes.get(nodeId)?.connectionRadius ?? 0.45;
  }

  private measureConnectionRadius(root: TransformNode): number {
    const childMeshes = root.getChildMeshes(false);
    if (childMeshes.length === 0) {
      return 0.45;
    }

    const maxRadius = childMeshes.reduce((radius, mesh) => {
      const boundingInfo = mesh.getBoundingInfo();
      return Math.max(radius, boundingInfo.boundingSphere.radiusWorld);
    }, 0);

    return Math.max(maxRadius, 0.18);
  }

  private arrangeAllNodes(): void {
    if (!this.sceneData) {
      return;
    }

    const nodes = this.sceneData.graphs.flatMap((graph) => graph.nodes);
    const edges = this.sceneData.graphs.flatMap((graph) => graph.edges);
    const arranged = arrangeNodes(nodes, edges);

    this.animateNodePositions(arranged);
    this.applySelection(this.selected, false);
  }

  private arrangeSelectedNodes(nodeIds: string[]): void {
    const center = this.getNodeCenter(nodeIds);
    if (!center || !this.sceneData) {
      return;
    }

    const selectedNodeIds = new Set(nodeIds);
    const selectedNodes = Array.from(this.nodes.values())
      .filter(({ node }) => selectedNodeIds.has(node.id))
      .map(({ node }) => node);
    const selectedEdges = this.sceneData.graphs
      .flatMap((graph) => graph.edges)
      .filter((edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target));
    const arranged = arrangeNodes(selectedNodes, selectedEdges, center);

    this.animateNodePositions(arranged);
    this.applySelection(this.selected, false);
  }

  private setNodePosition(nodeId: string, position: Vector3): void {
    const rendered = this.nodes.get(nodeId);
    if (!rendered) {
      return;
    }

    const constrained = clampNodePosition(position, rendered.connectionRadius);
    rendered.root.position.copyFrom(constrained);
    rendered.position.copyFrom(constrained);
    this.nodePositions.set(nodeId, constrained.clone());
  }

  private constrainDragDelta(nodeIds: string[], delta: Vector3): Vector3 {
    const constrained = delta.clone();
    const maxDownwardDelta = nodeIds.reduce((maxDelta, nodeId) => {
      const rendered = this.nodes.get(nodeId);
      if (!rendered) {
        return maxDelta;
      }

      return Math.max(maxDelta, nodeFloorLimit(rendered.connectionRadius) - rendered.root.position.y);
    }, Number.NEGATIVE_INFINITY);

    if (constrained.y < maxDownwardDelta) {
      constrained.y = maxDownwardDelta;
    }

    return constrained;
  }

  private rebuildEdges(): void {
    if (!this.sceneData) {
      return;
    }

    this.edges.forEach(({ mesh, glow, arrow, flow }) => {
      mesh.dispose(false, true);
      glow.dispose(false, true);
      arrow?.dispose(false, true);
      flow?.dispose(false, true);
    });
    this.edges.clear();

    this.sceneData.graphs.forEach((graph) => {
      graph.edges.forEach((edge) => {
        const source = this.nodePositions.get(edge.source);
        const target = this.nodePositions.get(edge.target);
        if (source && target) {
          this.createEdgeFromPositions(graph.id, edge, source, target);
        }
      });
    });

    this.applySelection(this.selected);
  }

  private animate(): void {
    const now = performance.now();
    this.updateNodeTransitions(now);
    this.animateIdle(now / 1000);
    this.animateEdgeFlows(now / 1000);
    this.updateVisualEffects(now);
  }

  private animateIdle(time: number): void {
    this.nodes.forEach((rendered) => {
      const amp = idleAmplitude(rendered.node);
      const speed = idleSpeed(rendered.node);
      const breath = 1 + Math.sin(time * speed + rendered.idlePhase) * amp;
      const corePulse = 1 + Math.sin(time * speed * 1.7 + rendered.idlePhase) * (amp * 3.1);
      rendered.visualRoot.scaling.setAll(rendered.selectionScale * breath);
      rendered.core.scaling.setAll(corePulse);

      const material = rendered.mesh.material;
      if (material && "emissiveColor" in material) {
        const base = baseEmission(rendered.node);
        const lift = Math.max(0, Math.sin(time * speed * 1.35 + rendered.idlePhase)) * 0.14;
        material.emissiveColor = rendered.color.scale(base + lift);
      }
    });
  }

  private animateEdgeFlows(time: number): void {
    this.edges.forEach((rendered) => {
      const pulse = 0.84 + Math.sin(time * 1.6 + rendered.flowPhase) * 0.16;
      rendered.glowMaterial.alpha = neonGlowAlpha(rendered.edge, this.isEdgeSelected(rendered.edge.id)) *
        rendered.glow.visibility *
        pulse;

      if (!rendered.flow || !rendered.flowMaterial) {
        return;
      }

      const speed = rendered.edge.directed ? 0.16 : 0.07;
      const progress = (time * speed + rendered.flowPhase / (Math.PI * 2)) % 1;
      rendered.flow.position.copyFrom(pointOnPath(rendered.path, progress));
      const fade = 0.28 + Math.sin(progress * Math.PI) * 0.34;
      rendered.flowMaterial.alpha = rendered.mesh.visibility * fade;
    });
  }

  private isEdgeSelected(edgeId: string): boolean {
    return this.selected?.type === "edge" && this.selected.edge.id === edgeId;
  }

  private updateNodeTransitions(now: number): void {
    if (this.transitions.size === 0) {
      return;
    }

    let moved = false;
    this.transitions.forEach((transition, nodeId) => {
      const rendered = this.nodes.get(nodeId);
      if (!rendered) {
        this.transitions.delete(nodeId);
        return;
      }

      const elapsed = now - transition.startedAt;
      const progress = Math.min(1, elapsed / transition.duration);
      const eased = easeOutCubic(progress);
      const next = Vector3.Lerp(transition.from, transition.to, eased);
      this.setNodePosition(nodeId, next);
      moved = true;

      if (progress >= 1) {
        this.transitions.delete(nodeId);
      }
    });

    if (moved) {
      this.rebuildEdges();
    }
  }

  private updateVisualEffects(now: number): void {
    this.effects = this.effects.filter((effect) => {
      const progress = Math.min(1, (now - effect.startedAt) / effect.duration);
      const eased = easeOutCubic(progress);
      const fade = 1 - progress;

      if (effect.type === "halo") {
        effect.mesh.scaling.setAll(0.6 + eased * 2.2 * effect.intensity);
        effect.material.alpha = fade * 0.56 * effect.intensity;
      } else {
        effect.mesh.position.copyFrom(pointOnPath(effect.path, eased));
        effect.material.alpha = Math.sin(progress * Math.PI) * 0.82 * effect.intensity;
      }

      if (progress < 1) {
        return true;
      }

      effect.mesh.dispose(false, true);
      return false;
    });
  }

  private animateNodePositions(targets: Map<string, { x: number; y: number; z: number }>): void {
    const nodeIds: string[] = [];
    const now = performance.now();

    targets.forEach((position, nodeId) => {
      const rendered = this.nodes.get(nodeId);
      if (!rendered) {
        return;
      }

      const target = clampNodePosition(toVector3(position), rendered.connectionRadius);
      if (Vector3.DistanceSquared(rendered.root.position, target) < 0.0001) {
        this.setNodePosition(nodeId, target);
        return;
      }

      this.transitions.set(nodeId, {
        nodeId,
        from: clampNodePosition(rendered.root.position, rendered.connectionRadius),
        to: target,
        startedAt: now,
        duration: 720,
      });
      nodeIds.push(nodeId);
    });

    this.emitGraphEvent({ type: "movement", nodeIds, intensity: 0.5 });
  }

  private createEdgeFlow(edge: GraphEdge, path: Vector3[], color: Color3): { flow?: Mesh; material?: StandardMaterial } {
    if (!edge.directed && edge.visual?.emphasis !== "strong") {
      return {};
    }

    const flow = MeshBuilder.CreateSphere(`edge-flow-${edge.id}`, { diameter: 0.16, segments: 10 }, this.scene);
    const material = this.createEffectMaterial(`edge-flow-material-${edge.id}`, color, 0.4);
    flow.parent = this.root;
    flow.position.copyFrom(pointOnPath(path, seededUnit(edge.id)));
    flow.material = material;
    flow.isPickable = false;
    return { flow, material };
  }

  private createNodeHalo(nodeId: string, eventType: GraphVisualEventType, intensity: number): void {
    const rendered = this.nodes.get(nodeId);
    if (!rendered) {
      return;
    }

    this.createHaloAt(rendered.root.position, rendered.color, intensityForEvent(eventType, intensity));
  }

  private createHaloAt(position: Vector3, color: Color3, intensity: number): void {
    const halo = MeshBuilder.CreateTorus(
      `node-event-halo-${this.effects.length}`,
      { diameter: 0.92, thickness: 0.028, tessellation: 36 },
      this.scene,
    );
    const material = this.createEffectMaterial(`node-event-halo-material-${this.effects.length}`, color, 0.5);
    halo.parent = this.effectsRoot;
    halo.position.copyFrom(position);
    halo.rotation.x = Math.PI / 2;
    halo.material = material;
    halo.isPickable = false;
    this.effects.push({
      type: "halo",
      mesh: halo,
      material,
      startedAt: performance.now(),
      duration: 820,
      intensity,
    });
  }

  private createEdgePulse(edgeId: string, eventType: GraphVisualEventType, intensity: number): void {
    const rendered = this.edges.get(edgeId);
    if (!rendered) {
      return;
    }

    const pulse = MeshBuilder.CreateSphere(`edge-event-pulse-${edgeId}-${this.effects.length}`, { diameter: 0.2, segments: 12 }, this.scene);
    const material = this.createEffectMaterial(`edge-event-pulse-material-${edgeId}-${this.effects.length}`, rendered.color, 0.7);
    pulse.parent = this.effectsRoot;
    pulse.position.copyFrom(rendered.path[0]);
    pulse.material = material;
    pulse.isPickable = false;
    this.effects.push({
      type: "edge-pulse",
      mesh: pulse,
      material,
      path: rendered.path.map((point) => point.clone()),
      startedAt: performance.now(),
      duration: eventType === "selection" ? 620 : 880,
      intensity: intensityForEvent(eventType, intensity),
    });
  }

  private createEffectMaterial(name: string, color: Color3, alpha: number): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = color;
    material.emissiveColor = color.scale(1.55);
    material.alpha = alpha;
    material.disableLighting = true;
    return material;
  }

  private createNodeFire(node: GraphNode, emitter: Mesh): ParticleSystem | undefined {
    const intensity = fireIntensity(node);
    if (intensity <= 0) {
      return undefined;
    }

    const radius = node.domain === "retro" || node.domain === "decision" ? 0.64 : 0.52;
    const fire = new ParticleSystem(`node-fire-${node.id}`, Math.round(110 + intensity * 180), this.scene);
    const color = nodeColorForRender(node);
    fire.particleTexture = this.getFireTexture();
    fire.emitter = emitter;
    fire.blendMode = ParticleSystem.BLENDMODE_ADD;
    fire.isLocal = true;
    fire.updateSpeed = 0.011;
    fire.minLifeTime = 0.24;
    fire.maxLifeTime = 0.58 + intensity * 0.24;
    fire.minSize = 0.08 + intensity * 0.04;
    fire.maxSize = 0.24 + intensity * 0.22;
    fire.emitRate = 18 + intensity * 58;
    fire.minEmitPower = 0.08;
    fire.maxEmitPower = 0.36 + intensity * 0.12;
    fire.minAngularSpeed = -1.8;
    fire.maxAngularSpeed = 1.8;
    fire.gravity = new Vector3(0, 0.12 + intensity * 0.2, 0);
    fire.createDirectedSphereEmitter(
      radius,
      new Vector3(-0.2, 0.24, -0.2),
      new Vector3(0.2, 0.58 + intensity * 0.26, 0.2),
    );
    const hotColor = liftColor(color, 0.48);
    const midColor = liftColor(color, 0.12);
    const smokeColor = color.scale(0.28);
    fire.addColorGradient(0, new Color4(hotColor.r, hotColor.g, hotColor.b, 0.82));
    fire.addColorGradient(0.3, new Color4(midColor.r, midColor.g, midColor.b, 0.64));
    fire.addColorGradient(0.72, new Color4(color.r, color.g, color.b, 0.24));
    fire.addColorGradient(1, new Color4(smokeColor.r, smokeColor.g, smokeColor.b, 0));
    fire.addSizeGradient(0, 0.5);
    fire.addSizeGradient(0.38, 1.16);
    fire.addSizeGradient(1, 0.12);
    fire.preWarmCycles = 18;
    fire.preWarmStepOffset = 2;
    fire.renderingGroupId = 1;
    fire.start();
    return fire;
  }

  private getFireTexture(): Texture {
    if (!this.fireTexture) {
      this.fireTexture = new Texture(createFireFlareDataUrl(), this.scene, true, false, Texture.BILINEAR_SAMPLINGMODE);
    }

    return this.fireTexture;
  }

  private emitThrottledMovementEvent(nodeIds: string[], intensity: number): void {
    const now = performance.now();
    if (now - this.lastMovementEffectAt < 260) {
      return;
    }

    this.lastMovementEffectAt = now;
    this.emitGraphEvent({ type: "movement", nodeIds, intensity });
  }

  private captureSnapshot(): SceneSnapshot | null {
    if (!this.sceneData) {
      return null;
    }

    return {
      nodes: new Map(this.sceneData.graphs.flatMap((graph) => graph.nodes.map((node) => [node.id, node] as const))),
      edges: new Set(this.sceneData.graphs.flatMap((graph) => graph.edges.map((edge) => edge.id))),
      positions: new Map(Array.from(this.nodePositions.entries()).map(([nodeId, position]) => [nodeId, position.clone()])),
    };
  }

  private playSceneDiff(previous: SceneSnapshot | null): void {
    const currentNodes = new Map(this.sceneData?.graphs.flatMap((graph) => graph.nodes.map((node) => [node.id, node] as const)) ?? []);
    const currentEdges = new Set(this.sceneData?.graphs.flatMap((graph) => graph.edges.map((edge) => edge.id)) ?? []);

    if (!previous) {
      this.emitGraphEvent({
        type: "created",
        nodeIds: Array.from(currentNodes.keys()),
        edgeIds: Array.from(currentEdges),
        intensity: 0.42,
      });
      return;
    }

    const createdNodeIds = Array.from(currentNodes.keys()).filter((nodeId) => !previous.nodes.has(nodeId));
    const changedNodeIds = Array.from(currentNodes.entries())
      .filter(([nodeId, node]) => {
        const previousNode = previous.nodes.get(nodeId);
        return previousNode ? nodeAnimationFingerprint(previousNode) !== nodeAnimationFingerprint(node) : false;
      })
      .map(([nodeId]) => nodeId);
    const createdEdgeIds = Array.from(currentEdges).filter((edgeId) => !previous.edges.has(edgeId));

    previous.nodes.forEach((node, nodeId) => {
      if (currentNodes.has(nodeId)) {
        return;
      }

      const position = previous.positions.get(nodeId);
      if (position) {
        this.createHaloAt(position, nodeColorForRender(node), 0.85);
      }
    });

    this.emitGraphEvent({ type: "created", nodeIds: createdNodeIds, edgeIds: createdEdgeIds, intensity: 0.85 });
    this.emitGraphEvent({ type: "state-change", nodeIds: changedNodeIds, intensity: 1 });
  }

  private findNeighborNodeIds(nodeIds: Set<string>): Set<string> {
    const neighborIds = new Set<string>();
    this.edges.forEach(({ edge }) => {
      if (nodeIds.has(edge.source)) {
        neighborIds.add(edge.target);
      }
      if (nodeIds.has(edge.target)) {
        neighborIds.add(edge.source);
      }
    });
    return neighborIds;
  }
}

const COLOR_TOKENS: Record<string, string> = {
  todo: "#4fd1c5",
  email: "#8fb3ff",
  person: "#f5c76b",
  organization: "#c77dff",
  project: "#7dd87d",
  jira: "#58a6ff",
  "jira-issue": "#58a6ff",
  "action-proposal": "#ff7a59",
  urgent: "#ff4d6d",
};

function colorForToken(token: string): Color3 {
  return Color3.FromHexString(COLOR_TOKENS[token] ?? "#9fb7c7");
}

function pointOnPath(path: Vector3[], progress: number): Vector3 {
  if (path.length === 0) {
    return Vector3.Zero();
  }

  if (path.length === 1) {
    return path[0].clone();
  }

  const clamped = Math.min(1, Math.max(0, progress));
  const scaled = clamped * (path.length - 1);
  const index = Math.min(path.length - 2, Math.floor(scaled));
  return Vector3.Lerp(path[index], path[index + 1], scaled - index);
}

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

function seededPhase(value: string): number {
  return seededUnit(value) * Math.PI * 2;
}

function seededUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function idleAmplitude(node: GraphNode): number {
  if (node.status === "dismissed" || node.status === "complete") {
    return 0.006;
  }

  if (node.status === "active" || node.status === "unread") {
    return 0.032;
  }

  if (node.status === "blocked" || node.status === "waiting") {
    return 0.024;
  }

  return 0.017;
}

function idleSpeed(node: GraphNode): number {
  // Domain-specific idle-orbit speed. Faster = feels more "alive" or urgent.
  const domainSpeed: Record<string, number> = {
    // people + orgs — slow, background
    person: 0.95,
    organization: 0.82,
    // memory-kind — mostly calm, retros perk up (they're "open" items)
    memory: 0.9,
    decision: 0.8,
    spec: 0.75,
    preference: 0.85,
    retro: 1.9,
    task: 1.35,
    // content
    message: 1.52,
    document: 0.9,
    meeting: 1.05,
    // work items
    issue: 1.12,
    "merge-request": 1.25,
    commit: 1.0,
    // containers — very slow (they're scopes)
    project: 0.88,
    "jira-project": 0.7,
    "confluence-space": 0.7,
    "figma-team": 0.7,
    "figma-project": 0.75,
    channel: 0.8,
    repo: 0.78,
  };

  const speed = domainSpeed[node.domain] ?? 1.2;
  return node.status === "active" || node.status === "unread" ? speed * 1.18 : speed;
}

function baseEmission(node: GraphNode): number {
  if (node.status === "dismissed" || node.status === "complete") {
    return 0.12;
  }

  if (node.status === "active" || node.status === "unread") {
    return 0.48;
  }

  return 0.36;
}

function intensityForEvent(eventType: GraphVisualEventType, intensity: number): number {
  const multiplier = {
    created: 1.1,
    deleted: 0.95,
    "state-change": 1.28,
    movement: 0.66,
    selection: 0.82,
  }[eventType];

  return intensity * multiplier;
}

function neonGlowAlpha(edge: GraphEdge, selected: boolean): number {
  const emphasisBoost = edge.visual?.emphasis === "strong" ? 0.045 : 0;
  const directedBoost = edge.directed ? 0.02 : 0;
  return (selected ? 0.18 : 0.105) + emphasisBoost + directedBoost;
}

function clampNodePosition(position: Vector3, connectionRadius: number): Vector3 {
  const constrained = position.clone();
  constrained.y = Math.max(constrained.y, nodeFloorLimit(connectionRadius));
  return constrained;
}

function nodeFloorLimit(connectionRadius: number): number {
  return REFLECTIVE_FLOOR_Y + connectionRadius + NODE_FLOOR_CLEARANCE;
}

function toVectorTuple(position: Vector3): VectorTuple {
  return {
    x: position.x,
    y: position.y,
    z: position.z,
  };
}

function nodeAnimationFingerprint(node: GraphNode): string {
  return JSON.stringify({
    status: node.status,
    priority: "priority" in node ? node.priority : undefined,
    taskStatus: "taskStatus" in node ? node.taskStatus : undefined,
    signalType: "signalType" in node ? node.signalType : undefined,
    state: "state" in node ? node.state : undefined,
    issueStatus: "issueStatus" in node ? node.issueStatus : undefined,
  });
}

function fireIntensity(node: GraphNode): number {
  if (node.status === "dismissed" || node.status === "complete") {
    return 0;
  }

  // Retros represent open agent-flagged signals — visible attention marker.
  if (node.domain === "retro") {
    return 0.54;
  }

  // Tasks burn hotter with priority + activity.
  if (node.domain === "task") {
    const priorityIntensity: Record<string, number> = {
      urgent: 0.95,
      high: 0.62,
      medium: node.status === "active" ? 0.38 : 0.16,
      low: node.status === "active" ? 0.22 : 0.12,
    };
    return priorityIntensity[node.priority ?? ""] ?? 0.16;
  }

  // Open MRs glow like fresh mail did.
  if (node.domain === "merge-request" && node.status === "active") {
    return 0.56;
  }

  return node.status === "active" ? 0.24 : 0;
}

function liftColor(color: Color3, amount: number): Color3 {
  return new Color3(
    color.r + (1 - color.r) * amount,
    color.g + (1 - color.g) * amount,
    color.b + (1 - color.b) * amount,
  );
}

function createFireFlareDataUrl(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (!context) {
    return "";
  }

  const gradient = context.createRadialGradient(48, 48, 2, 48, 48, 48);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.2, "rgba(255,255,255,0.88)");
  gradient.addColorStop(0.48, "rgba(210,210,210,0.46)");
  gradient.addColorStop(0.76, "rgba(100,100,100,0.18)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
