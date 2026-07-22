/**
 * Fallback mock scene used only as a dev fallback when Neo4j is
 * unreachable. Matches the neocortex domain types (see
 * ../domain/types.ts).
 */

import type { GraphSceneData } from "../domain/types";

export const mockGraphScene: GraphSceneData = {
  id: "nebula-wayfinder-mock",
  label: "Nebula Wayfinder (mock)",
  generatedAt: "2026-07-22T12:00:00.000Z",
  graphs: [
    {
      id: "memory-cloud",
      label: "Memory",
      domain: "mixed",
      nodes: [
        {
          id: "memory-sample-1",
          domain: "memory",
          label: "Prefer terse commit messages…",
          content: "Prefer terse commit messages that focus on the why, not the what.",
          kindLabel: "Memory",
          status: "idle",
          source: { system: "neocortex", externalId: "memory-sample-1" },
        },
        {
          id: "decision-sample-1",
          domain: "decision",
          label: "Use Bolt over HTTP for local Neo4j…",
          content: "Use Bolt over HTTP for local Neo4j — lower per-query latency.",
          kindLabel: "Decision",
          status: "idle",
          source: { system: "neocortex", externalId: "decision-sample-1" },
        },
        {
          id: "retro-sample-1",
          domain: "retro",
          label: "Miss: no prior context on wayfinder mapping",
          content: "Miss: searched for wayfinder mapping and found no prior notes.",
          kindLabel: "Retro",
          signalType: "miss",
          status: "idle",
          source: { system: "neocortex", externalId: "retro-sample-1" },
        },
      ],
      edges: [
        {
          id: "edge-decision-memory",
          source: "decision-sample-1",
          target: "memory-sample-1",
          kind: "linked_to",
          label: "linked to",
          directed: true,
          visual: { weight: 0.9, colorToken: "memory" },
        },
      ],
    },
    {
      id: "task-cloud",
      label: "Tasks",
      domain: "task",
      nodes: [
        {
          id: "task-sample-1",
          domain: "task",
          label: "Wire up neocortex frontend",
          title: "Wire up neocortex frontend",
          priority: "high",
          taskStatus: "open",
          status: "active",
          source: { system: "neocortex", externalId: "task-sample-1" },
        },
      ],
      edges: [],
    },
    {
      id: "people-cloud",
      label: "People & Orgs",
      domain: "mixed",
      nodes: [
        {
          id: "person-alex",
          domain: "person",
          label: "Alex Chen",
          displayName: "Alex Chen",
          primaryEmail: "alex@example.com",
          kind: "human",
          status: "idle",
          source: { system: "neocortex", externalId: "person-alex" },
        },
      ],
      edges: [],
    },
  ],
};
