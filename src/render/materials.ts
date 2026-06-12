import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { GraphNode, NodeDomain } from "../domain/types";

export const domainPalette: Record<NodeDomain, Color3> = {
  todo: Color3.FromHexString("#4fd1c5"),
  email: Color3.FromHexString("#8fb3ff"),
  person: Color3.FromHexString("#f5c76b"),
  organization: Color3.FromHexString("#c77dff"),
  "action-proposal": Color3.FromHexString("#ff7a59"),
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
  material.maxSimultaneousLights = 12;
  return material;
}

export function createEdgeMaterial(scene: Scene, id: string, color: Color3, selected = false): StandardMaterial {
  const material = new StandardMaterial(`edge-material-${id}`, scene);
  const hotCore = new Color3(
    Math.min(1, color.r * 0.55 + 0.32),
    Math.min(1, color.g * 0.55 + 0.32),
    Math.min(1, color.b * 0.55 + 0.32),
  );

  material.diffuseColor = hotCore.scale(selected ? 0.95 : 0.72);
  material.emissiveColor = color.scale(selected ? 1.35 : 0.82).add(hotCore.scale(selected ? 0.4 : 0.22));
  material.alpha = selected ? 0.9 : 0.72;
  material.disableLighting = true;
  material.maxSimultaneousLights = 12;
  return material;
}

export function createEdgeGlowMaterial(scene: Scene, id: string, color: Color3, selected = false): StandardMaterial {
  const material = new StandardMaterial(`edge-glow-material-${id}`, scene);
  material.diffuseColor = color.scale(0.08);
  material.emissiveColor = color.scale(selected ? 1.45 : 0.92);
  material.alpha = selected ? 0.16 : 0.1;
  material.disableLighting = true;
  material.backFaceCulling = false;
  return material;
}

export function createEdgeArrowMaterial(scene: Scene, id: string, color: Color3): StandardMaterial {
  const material = new StandardMaterial(`edge-arrow-material-${id}`, scene);
  material.diffuseColor = color.scale(0.28);
  material.emissiveColor = color.scale(0.42);
  material.alpha = 0.34;
  material.disableLighting = true;
  return material;
}
