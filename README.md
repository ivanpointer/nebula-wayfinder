# Nebula Wayfinder

Browser-native 3D knowledge graph visualization for [second-brain](../second-brain)'s
neocortex Neo4j graph, built with Vite, TypeScript, and Babylon.js.
Connects directly to neocortex's local Neo4j instance over Bolt and renders
live data as an interactive 3D scene.

## Prerequisites

1. The second-brain project running locally (`docker compose up -d` from the
   second-brain repo). Neo4j must be accessible at `bolt://localhost:7687`.

2. Node/npm available (or use Devbox below).

## Configuration

Copy `.env.example` to `.env` and set your credentials:

```sh
cp .env.example .env
```

```dotenv
VITE_NEO4J_URI=bolt://localhost:7687
VITE_NEO4J_USER=neo4j
VITE_NEO4J_PASSWORD=changeme   # matches NEO4J_PASSWORD in second-brain/.env
```

## Development

Use Devbox so the Node/npm toolchain is isolated to this project:

```sh
devbox shell
npm install
npm run dev
```

Or run scripts directly through Devbox:

```sh
devbox run install
devbox run dev
devbox run build
devbox run test
devbox run test:e2e
```

The dev server runs at `http://127.0.0.1:5173/`.

## Architecture

- Babylon.js owns the 3D scene, render loop, camera, picking, lighting, and post-processing.
- The UI overlay is framework-free HTML/CSS/TypeScript to avoid adding reconciliation overhead to the graph renderer.
- The renderer is isolated from the overlay so React, Vue, Solid, or another UI framework can be introduced later for panels and workflows without moving Babylon under that framework.
- **Backend**: live queries against neocortex's Neo4j via the official `neo4j-driver` over Bolt.
  See `src/services/neo4jClient.ts`, `neo4jMapper.ts`, and `graphService.ts`.
- **Node types** mirror neocortex's label schema. Rendered node kinds:
  memory-kind (`Memory`, `Decision`, `Spec`, `Preference`, `Retro`), `Task`,
  content (`Message`, `Document`, `Meeting`), people (`Person`, `Organization`),
  work items (`Issue`, `MergeRequest`, `Commit`), and containers
  (`Project`, `JiraProject`, `ConfluenceSpace`, `FigmaTeam`, `FigmaProject`, `Channel`, `Repo`).
  Adding a new neocortex label requires adding a mapper in
  `src/services/neo4jMapper.ts`, a query in `graphService.ts`, and a
  palette entry in `render/materials.ts`.
- **Edges** rendered include structural (`AUTHORED_BY`, `SENT_TO`, `CC_TO`,
  `IN_CHANNEL`, `IN_REPO`, `IN_JIRA_PROJECT`, `IN_CONFLUENCE_SPACE`,
  `IN_FIGMA_PROJECT`, `IN_FIGMA_TEAM`, `MERGES_INTO`, `COMMITTED_TO`,
  `SCOPED_TO`, `ASSIGNED_TO`, `REPORTED_BY`, `REVIEWED_BY`, `PARENT_OF`,
  `CHILD_OF`, `LAST_EDITED_BY`, `EVIDENCED_BY`, `DERIVED_FROM`,
  `SUPERSEDES`, `LINKED_TO`, `HAS_ATTACHMENT`) and inferred
  (`ABOUT`, `MENTIONS`, `RELATES_TO`, `WORKS_AT`, `INTERACTS_WITH`,
  `CO_RETRIEVED_WITH`, `LED_TO_CAPTURE`).
- **Actions**: neocortex owns writes through its Python pipelines, so the
  frontend does not mutate Neo4j. The `ActionService` is a no-op today
  and reserved for a future neocortex-hosted mutation surface.

## Verification

```sh
devbox run build
devbox run test
devbox run test:e2e
```
