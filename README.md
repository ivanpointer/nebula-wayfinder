# Nebula Wayfinder

Browser-native 3D knowledge graph visualization for [unibrain](../unibrain), built with Vite, TypeScript, and Babylon.js.  
Connects directly to unibrain's local Neo4j instance over Bolt and renders live data as an interactive 3D scene.

## Prerequisites

1. The unibrain project running locally (`docker compose up -d` from the unibrain repo).  
   Neo4j must be accessible at `bolt://localhost:7687`.

2. Node/npm available (or use Devbox below).

## Configuration

Copy `.env.example` to `.env` and set your credentials:

```sh
cp .env.example .env
```

```dotenv
VITE_NEO4J_URI=bolt://localhost:7687
VITE_NEO4J_USER=neo4j
VITE_NEO4J_PASSWORD=change-this-password   # matches NEO4J_PASSWORD in unibrain/.env
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
- **Backend**: live queries against unibrain's Neo4j via the official `neo4j-driver` over Bolt.  
  See `src/services/neo4jClient.ts`, `neo4jMapper.ts`, and `graphService.ts`.
- **Node types** mirror unibrain's label schema: `Todo`, `EmailMessage`, `Person`, `Organization`, `ActionProposal`.  
  Adding a new unibrain label requires adding a mapper in `src/services/neo4jMapper.ts` and a query branch in `graphService.ts`.
- **Actions** (mark done, dismiss, set priority) write back to Neo4j via Cypher mutations in `actionService.ts`, with an optimistic local update for immediate UI feedback.

## Verification

```sh
devbox run build
devbox run test
devbox run test:e2e
```
