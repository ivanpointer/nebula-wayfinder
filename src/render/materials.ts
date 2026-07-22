import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { GraphNode, NodeDomain } from "../domain/types";

export const domainPalette: Record<NodeDomain, Color3> = {
  // People + orgs
  person: Color3.FromHexString("#f5c76b"),
  organization: Color3.FromHexString("#c77dff"),
  // Memory kinds — warm, distinct hues so the knowledge core stands out
  memory: Color3.FromHexString("#f6a5c0"),
  decision: Color3.FromHexString("#e05780"),
  spec: Color3.FromHexString("#b28dff"),
  preference: Color3.FromHexString("#ffb86b"),
  task: Color3.FromHexString("#4fd1c5"),
  retro: Color3.FromHexString("#ff7a59"),
  // Content
  message: Color3.FromHexString("#8fb3ff"),
  document: Color3.FromHexString("#78d8b0"),
  meeting: Color3.FromHexString("#f7d060"),
  // Work items
  issue: Color3.FromHexString("#58a6ff"),
  "merge-request": Color3.FromHexString("#a371f7"),
  commit: Color3.FromHexString("#7c8db5"),
  // Containers / scopes
  project: Color3.FromHexString("#7dd87d"),
  "jira-project": Color3.FromHexString("#3388dd"),
  "confluence-space": Color3.FromHexString("#4aa1c8"),
  "figma-team": Color3.FromHexString("#ff5e5b"),
  "figma-project": Color3.FromHexString("#ff8fa3"),
  channel: Color3.FromHexString("#63c5da"),
  repo: Color3.FromHexString("#9ba6b2"),
  // Base color for unknown labels; the actual hue is rotated per
  // primary label (see nodeColorForRender) so distinct novel types
  // stay visually distinguishable.
  unknown: Color3.FromHexString("#a0a0a0"),
};

// Deterministic hash → [0, 1) hue rotation for coloring unknown labels.
// FNV-1a keeps this stable across sessions without adding a dep.
function hashLabelToHue(label: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return (h % 360) / 360;
}

// HSL → RGB helper for hue-rotating the unknown base color.
function hslToColor3(h: number, s: number, l: number): Color3 {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  return new Color3(r + m, g + m, b + m);
}

// Returns the render color for a node, factoring in hash-based coloring
// for unknown labels so different novel labels don't collapse to one hue.
export function nodeColorForRender(node: GraphNode): Color3 {
  if (node.domain === "unknown" && "primaryLabel" in node) {
    return hslToColor3(hashLabelToHue((node as { primaryLabel: string }).primaryLabel), 0.55, 0.6);
  }
  return domainPalette[node.domain];
}

export function createNodeMaterial(scene: Scene, node: GraphNode): PBRMaterial {
  const base = nodeColorForRender(node);
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
