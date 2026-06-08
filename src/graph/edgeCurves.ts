import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { VectorTuple } from "../domain/types";

export function makeEdgeCurve(source: VectorTuple, target: VectorTuple, lift = 1.6): Vector3[] {
  const start = toVector3(source);
  const end = toVector3(target);
  const midpoint = start.add(end).scale(0.5);
  const distance = Vector3.Distance(start, end);
  const control = midpoint.add(new Vector3(0, lift + distance * 0.08, 0));

  const points: Vector3[] = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    points.push(quadraticBezier(start, control, end, t));
  }

  return points;
}

export function pointBeforeTarget(points: Vector3[], target: Vector3, distanceFromTarget: number): Vector3 {
  let remaining = distanceFromTarget;
  let previous = target;

  for (let index = points.length - 2; index >= 0; index -= 1) {
    const current = points[index];
    const segmentLength = Vector3.Distance(previous, current);
    if (segmentLength >= remaining) {
      return previous.subtract(previous.subtract(current).normalize().scale(remaining));
    }

    remaining -= segmentLength;
    previous = current;
  }

  return points[0] ?? target;
}

export function toVector3(position: VectorTuple): Vector3 {
  return new Vector3(position.x, position.y, position.z);
}

function quadraticBezier(start: Vector3, control: Vector3, end: Vector3, t: number): Vector3 {
  const inverse = 1 - t;
  return start.scale(inverse * inverse).add(control.scale(2 * inverse * t)).add(end.scale(t * t));
}
