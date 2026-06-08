import { mockGraphScene } from "../data/mockGraphScene";
import type { GraphSceneData } from "../domain/types";

export async function fetchGraphScene(): Promise<GraphSceneData> {
  return structuredClone(mockGraphScene);
}
