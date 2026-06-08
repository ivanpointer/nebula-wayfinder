import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { makeEdgeCurve, toVector3 } from "../graph/edgeCurves";
import { layoutGraphClouds, type PositionedNode } from "../graph/layout";
import type { GraphEdge, GraphNode, GraphSceneData, Selection } from "../domain/types";
import { createEdgeMaterial, createNodeMaterial, domainPalette } from "./materials";

interface RenderedNode {
  graphId: string;
  node: GraphNode;
  root: TransformNode;
  mesh: Mesh;
  position: Vector3;
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

  private selected: Selection = null;

  constructor(private scene: Scene) {
    this.root = new TransformNode("graph-root", scene);
  }

  render(sceneData: GraphSceneData): void {
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

  dispose(): void {
    this.root.dispose(false, true);
    this.nodes.clear();
    this.edges.clear();
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
    const selectedNodeId = selection?.type === "node" ? selection.node.id : undefined;
    const selectedEdgeId = selection?.type === "edge" ? selection.edge.id : undefined;
    const neighborIds = selectedNodeId ? this.findNeighborNodeIds(selectedNodeId) : new Set<string>();

    this.nodes.forEach((rendered) => {
      const isSelected = rendered.node.id === selectedNodeId;
      const isNeighbor = neighborIds.has(rendered.node.id);
      rendered.mesh.scaling.setAll(isSelected ? 1.28 : isNeighbor ? 1.12 : 1);
      rendered.mesh.visibility = !selection || isSelected || isNeighbor ? 1 : 0.42;
    });

    this.edges.forEach((rendered) => {
      const connectedToNode =
        selectedNodeId && (rendered.edge.source === selectedNodeId || rendered.edge.target === selectedNodeId);
      const isSelectedEdge = rendered.edge.id === selectedEdgeId;
      const visible = !selection || connectedToNode || isSelectedEdge;
      rendered.mesh.visibility = visible ? 1 : 0.18;
      if (rendered.arrow) {
        rendered.arrow.visibility = rendered.mesh.visibility;
      }
    });
  }

  private createNode({ graphId, node, position }: PositionedNode): void {
    const root = new TransformNode(`node-root-${node.id}`, this.scene);
    root.parent = this.root;
    root.position = toVector3(position);

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
    });
  }

  private createEdge(
    graphId: string,
    edge: GraphEdge,
    source: PositionedNode,
    target: PositionedNode,
  ): void {
    const color = edge.visual?.colorToken ? colorForToken(edge.visual.colorToken) : Color3.FromHexString("#9fb7c7");
    const points = makeEdgeCurve(source.position, target.position, edge.directed ? 1.9 : 1.45);
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

    const arrow = edge.directed ? this.createArrow(edge, points, color) : undefined;
    this.edges.set(edge.id, { graphId, edge, mesh: tube, arrow });
  }

  private createArrow(edge: GraphEdge, points: Vector3[], color: Color3): Mesh {
    const end = points[points.length - 1];
    const beforeEnd = points[points.length - 3] ?? points[0];
    const direction = end.subtract(beforeEnd).normalize();
    const arrow = MeshBuilder.CreateCylinder(
      `edge-arrow-${edge.id}`,
      { height: 0.42, diameterTop: 0, diameterBottom: 0.22, tessellation: 18 },
      this.scene,
    );
    arrow.parent = this.root;
    arrow.position = end.subtract(direction.scale(0.34));
    arrow.setDirection(direction);
    arrow.material = createEdgeMaterial(this.scene, `arrow-${edge.id}`, color, true);
    arrow.metadata = { edgeId: edge.id };
    return arrow;
  }

  private findNeighborNodeIds(nodeId: string): Set<string> {
    const neighborIds = new Set<string>();
    this.edges.forEach(({ edge }) => {
      if (edge.source === nodeId) {
        neighborIds.add(edge.target);
      }
      if (edge.target === nodeId) {
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
