import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { GraphNode, NodeDomain } from "../domain/types";

export const domainPalette: Record<NodeDomain, Color3> = {
  task: Color3.FromHexString("#4fd1c5"),
  contact: Color3.FromHexString("#f5c76b"),
  email: Color3.FromHexString("#8fb3ff"),
  message: Color3.FromHexString("#c77dff"),
  "agent-session": Color3.FromHexString("#ff7a59"),
};

export function createNodeMaterial(scene: Scene, node: GraphNode): PBRMaterial {
  const base = domainPalette[node.domain];
  const material = new PBRMaterial(`node-material-${node.id}`, scene);
  material.albedoColor = base.scale(0.58);
  material.emissiveColor = base.scale(node.status === "complete" || node.status === "dismissed" ? 0.12 : 0.42);
  material.metallic = 0.12;
  material.roughness = 0.18;
  material.alpha = node.status === "dismissed" ? 0.28 : 0.72;
  material.subSurface.isRefractionEnabled = true;
  material.subSurface.refractionIntensity = 0.32;
  material.subSurface.tintColor = base;
  material.subSurface.tintColorAtDistance = 1.8;
  material.useAlphaFromAlbedoTexture = false;
  material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  material.needDepthPrePass = true;
  return material;
}

export function createEdgeMaterial(scene: Scene, id: string, color: Color3, selected = false): StandardMaterial {
  const material = new StandardMaterial(`edge-material-${id}`, scene);
  material.diffuseColor = color.scale(selected ? 1.1 : 0.7);
  material.emissiveColor = color.scale(selected ? 1.35 : 0.6);
  material.alpha = selected ? 0.92 : 0.56;
  return material;
}
