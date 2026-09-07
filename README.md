# GIS Agent Core (WebGIS Copilot Runtime)

[![Author](https://img.shields.io/badge/author-edjsh175-blue.svg)](https://github.com/edjsh175)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

A high-cohesion, modular WebGIS capability layer and runtime adapter designed for seamless AI Agent integration. 

## Overview

This repository provides the core contracts, data querying abstractions, runtime state orchestration, and map engine adapters for bridging Large Language Model (LLM) agents with 2D/3D WebGIS applications.

### Architecture

```
src/
├── gis/
│   ├── contracts.js                  # Standard GIS Agent capability contracts & schemas
│   ├── catalog.js                    # Layer catalog & capability discovery
│   ├── application.js                # GIS application facade & client scope factory
│   ├── adapters/
│   │   ├── openlayersAdapter.js      # OpenLayers 2D map engine adapter
│   │   ├── geoserverAdapter.js       # GeoServer WFS/WMS protocol adapter
│   │   └── geoserverTransport.js     # Low-level network transport
│   ├── client/
│   │   └── createClientCapabilities.js  # Agent-facing client capabilities (highlight, locate, visible)
│   ├── data/
│   │   ├── createDataCapabilities.js    # Agent data capabilities (layer discovery, WFS queries)
│   │   └── filters.js                   # Filter builders & predicates
│   ├── integration/
│   │   ├── contracts.js              # Integration contracts & types
│   │   ├── createMapContext.js       # Browser-authoritative MapContext state sync
│   │   └── featureReferenceStore.js  # Feature identity & ephemeral reference management
│   └── runtime/
│       └── createMapRuntime.js       # Map session runtime & client lifecycle management
└── components/
    └── pipeline/decision/common/     # Shared highlight, style and interaction primitives
```

## Key Capabilities

1. **Agent Capability Contracts (`contracts.js`)**:
   - `DataCapabilities`: Discover layers (`listLayers`) and query spatial features (`queryFeatures`).
   - `ClientCapabilities`: Highlighting (`highlightFeatures`), camera navigation (`locateFeatures`), layer visibility control (`setLayerVisibility`).
2. **Ephemeral Feature References (`featureReferenceStore.js`)**:
   - Manages short-lived references (`ref_...`) and identity resolution across map layers and LLM conversation turns.
3. **Map Context Synchronization (`createMapContext.js`)**:
   - Maintains an authoritative, structured snapshot of map state (active layers, highlighted features, view bounds) for injection into agent system prompts.
4. **Engine Agnostic Abstraction**:
   - Decouples AI Agent tooling from specific WebGIS libraries through clean adapter interfaces.

## Verification & Tests

The module includes comprehensive unit and end-to-end browser integration tests:

```bash
# Run unit tests
npm run test:gis

# Run end-to-end browser capability tests
npm run test:gis:e2e
```

## License

MIT License. Developed by [edjsh175](https://github.com/edjsh175).
