import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { makeEdgeCurve, pointBeforeTarget, toVector3 } from "../graph/edgeCurves";
import { arrangeNodes, layoutGraphClouds, type PositionedNode } from "../graph/layout";
import type { GraphEdge, GraphNode, GraphSceneData, Selection } from "../domain/types";
import { createEdgeMaterial, createNodeMaterial, domainPalette } from "./materials";

interface RenderedNode {
  graphId: string;
  node: GraphNode;
  root: TransformNode;
  mesh: Mesh;
  position: Vector3;
  connectionRadius: number;
}

interface RenderedEdge {
  graphId: string;
  edge: GraphEdge;
  mesh: Mesh;
  arrow?: Mesh;
}

export class GraphRenderer {
  private root: TransformNode;

  private nodes = new Map<string, RenderedNode>();

  private edges = new Map<string, RenderedEdge>();

  private nodePositions = new Map<string, Vector3>();

  private sceneData: GraphSceneData | null = null;

  private selected: Selection = null;

  constructor(private scene: Scene) {
    this.root = new TransformNode("graph-root", scene);
  }

  render(sceneData: GraphSceneData): void {
    this.sceneData = sceneData;
    this.dispose();
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
  }

  resetLayout(): void {
    if (!this.sceneData) {
      return;
    }

    this.render(this.sceneData);
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
    this.root.dispose(false, true);
    this.nodes.clear();
    this.edges.clear();
    this.nodePositions.clear();
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

  applySelection(selection: Selection): void {
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
      rendered.mesh.scaling.setAll(isSelected ? 1.28 : isNeighbor ? 1.12 : 1);
      rendered.mesh.visibility = !selection || isSelected || isNeighbor ? 1 : 0.42;
    });

    this.edges.forEach((rendered) => {
      const connectedToNode =
        selectedNodeIds.has(rendered.edge.source) || selectedNodeIds.has(rendered.edge.target);
      const isSelectedEdge = rendered.edge.id === selectedEdgeId;
      const visible = !selection || connectedToNode || isSelectedEdge;
      rendered.mesh.visibility = visible ? 1 : 0.18;
      if (rendered.arrow) {
        rendered.arrow.visibility = rendered.mesh.visibility;
      }
    });
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

  moveNodes(nodeIds: string[], delta: Vector3): void {
    if (nodeIds.length === 0 || delta.lengthSquared() === 0) {
      return;
    }

    nodeIds.forEach((nodeId) => {
      const rendered = this.nodes.get(nodeId);
      if (!rendered) {
        return;
      }

      rendered.root.position.addInPlace(delta);
      rendered.position.copyFrom(rendered.root.position);
      this.nodePositions.set(nodeId, rendered.root.position.clone());
    });

    this.rebuildEdges();
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
    this.nodePositions.set(node.id, root.position.clone());

    const sphere = MeshBuilder.CreateSphere(
      `node-${node.id}`,
      { diameter: node.domain === "agent-session" ? 1.04 : 0.86, segments: 32 },
      this.scene,
    );
    sphere.parent = root;
    sphere.material = createNodeMaterial(this.scene, node);
    sphere.metadata = { nodeId: node.id };

    const core = MeshBuilder.CreateSphere(`node-core-${node.id}`, { diameter: 0.34, segments: 16 }, this.scene);
    core.parent = root;
    core.material = createEdgeMaterial(this.scene, `core-${node.id}`, domainPalette[node.domain], true);
    core.metadata = { nodeId: node.id };

    this.nodes.set(node.id, {
      graphId,
      node,
      root,
      mesh: sphere,
      position: root.position,
      connectionRadius: this.measureConnectionRadius(root),
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
    const tube = MeshBuilder.CreateTube(
      `edge-${edge.id}`,
      {
        path: points,
        radius: Math.max(0.035, 0.044 * (edge.visual?.weight ?? 1)),
        tessellation: 8,
        cap: Mesh.NO_CAP,
      },
      this.scene,
    );
    tube.parent = this.root;
    tube.material = createEdgeMaterial(this.scene, edge.id, color);
    tube.metadata = { edgeId: edge.id };

    const arrow = edge.directed ? this.createArrow(edge, points, target, color) : undefined;
    this.edges.set(edge.id, { graphId, edge, mesh: tube, arrow });
  }

  private createArrow(edge: GraphEdge, points: Vector3[], target: Vector3, color: Color3): Mesh {
    const targetRadius = this.getNodeConnectionRadius(edge.target);
    const tip = pointBeforeTarget(points, target, targetRadius * 0.9);
    const baseCenter = pointBeforeTarget(points, target, targetRadius + 0.42);
    const direction = tip.subtract(baseCenter).normalize();
    const upCandidate = Math.abs(Vector3.Dot(direction, Vector3.Up())) > 0.82 ? Vector3.Right() : Vector3.Up();
    const side = Vector3.Cross(direction, upCandidate).normalize();
    const wingLength = 0.34;
    const wingWidth = 0.2;
    const wingBase = tip.subtract(direction.scale(wingLength));
    const leftBase = wingBase.add(side.scale(wingWidth));
    const rightBase = wingBase.subtract(side.scale(wingWidth));
    const arrow = new Mesh(`edge-arrow-${edge.id}`, this.scene);
    arrow.parent = this.root;
    arrow.metadata = { edgeId: edge.id };

    [leftBase, rightBase].forEach((base, index) => {
      const wing = MeshBuilder.CreateTube(
        `edge-arrow-${edge.id}-wing-${index}`,
        {
          path: [base, tip],
          radius: 0.035,
          tessellation: 6,
          cap: Mesh.CAP_ALL,
        },
        this.scene,
      );
      wing.parent = arrow;
      wing.material = createEdgeMaterial(this.scene, `arrow-${edge.id}-wing-${index}`, color, true);
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

    arranged.forEach((position, nodeId) => this.setNodePosition(nodeId, toVector3(position)));

    this.rebuildEdges();
    this.applySelection(this.selected);
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

    arranged.forEach((position, nodeId) => {
      this.setNodePosition(nodeId, toVector3(position));
    });

    this.rebuildEdges();
    this.applySelection(this.selected);
  }

  private setNodePosition(nodeId: string, position: Vector3): void {
    const rendered = this.nodes.get(nodeId);
    if (!rendered) {
      return;
    }

    rendered.root.position.copyFrom(position);
    rendered.position.copyFrom(position);
    this.nodePositions.set(nodeId, position.clone());
  }

  private rebuildEdges(): void {
    if (!this.sceneData) {
      return;
    }

    this.edges.forEach(({ mesh, arrow }) => {
      mesh.dispose();
      arrow?.dispose();
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

function colorForToken(token: string): Color3 {
  const tokenColor = {
    task: "#4fd1c5",
    contact: "#f5c76b",
    email: "#8fb3ff",
    message: "#c77dff",
    agent: "#ff7a59",
    urgent: "#ff4d6d",
  }[token];

  return Color3.FromHexString(tokenColor ?? "#9fb7c7");
}
