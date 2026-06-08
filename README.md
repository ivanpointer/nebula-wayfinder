# Nebula Wayfinder

Browser-native 3D knowledge graph prototype built with Vite, TypeScript, and Babylon.js.

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
- The UI overlay is currently framework-free HTML/CSS/TypeScript to avoid adding reconciliation overhead to the graph renderer.
- The renderer is isolated from the overlay so React, Vue, Solid, or another UI framework can be introduced later for panels and workflows without moving Babylon under that framework.
- Graph data enters through a typed mock API boundary and can be replaced by real integrations later.
- Backend planning assumes Neo4j as the graph store behind a product-level API. See [Backend API Contract](docs/backend-api-contract.md).

## Verification

```sh
devbox run build
devbox run test
devbox run test:e2e
```
