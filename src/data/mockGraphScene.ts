/**
 * Fallback mock scene used only in unit tests and as a dev fallback when
 * Neo4j is unreachable.  Matches the updated unibrain domain types.
 */

import type { GraphSceneData } from "../domain/types";

export const mockGraphScene: GraphSceneData = {
  id: "nebula-wayfinder-mock",
  label: "Nebula Wayfinder (mock)",
  generatedAt: "2026-06-08T18:30:00.000Z",
  graphs: [
    {
      id: "todo-cloud",
      label: "Todos",
      domain: "todo",
      nodes: [
        {
          id: "todo-inbox-zero",
          domain: "todo",
          label: "Inbox triage",
          title: "Triage outstanding messages",
          status: "active",
          priority: "high",
          todoStatus: "open",
          reviewStatus: "draft",
          source: { system: "unibrain", externalId: "todo-inbox-zero" },
          metadata: { tags: ["focus", "communications"] },
        },
        {
          id: "todo-follow-up",
          domain: "todo",
          label: "Follow up",
          title: "Follow up on graph prototype direction",
          status: "waiting",
          priority: "medium",
          todoStatus: "waiting",
          reviewStatus: "draft",
          source: { system: "unibrain", externalId: "todo-follow-up" },
        },
        {
          id: "todo-write-spec",
          domain: "todo",
          label: "Write spec",
          title: "Draft integration contract for knowledge graph sources",
          status: "active",
          priority: "urgent",
          todoStatus: "open",
          reviewStatus: "draft",
          source: { system: "unibrain", externalId: "todo-write-spec" },
        },
      ],
      edges: [
        {
          id: "edge-todo-related",
          source: "todo-inbox-zero",
          target: "todo-follow-up",
          kind: "related_to",
          label: "related",
          directed: false,
          visual: { weight: 0.9, colorToken: "todo" },
        },
      ],
    },
    {
      id: "email-cloud",
      label: "Email",
      domain: "email",
      nodes: [
        {
          id: "email-research",
          domain: "email",
          label: "Research reply",
          sender: "alex@example.com",
          senderName: "Alex Chen",
          subject: "Re: visual knowledge graph references",
          timestamp: "2026-06-08T16:45:00.000Z",
          unread: true,
          status: "unread",
          source: { system: "gmail", externalId: "em-301" },
          metadata: { threadLength: 4 },
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
          status: "idle",
          source: { system: "unibrain", externalId: "email:alex@example.com" },
        },
      ],
      edges: [
        {
          id: "edge-email-person",
          source: "email-research",
          target: "person-alex",
          kind: "sent_by",
          label: "sent by",
          directed: true,
          visual: { weight: 1.1, colorToken: "email" },
        },
      ],
    },
  ],
};
