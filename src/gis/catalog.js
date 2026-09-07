/** Registered service metadata and map bindings share the existing config/tree source. */
export function createLayerCatalog() {
  let layers = new Map();
  let version = 0;
  let signature;
  const qualify = (name, workspace) =>
    name.includes(':') ? name : `${workspace}:${name}`;
  const idFor = (name) => `geoserver:${name}`;
  return {
    getVersion: () => version,
    getLayer: (id) => layers.get(id),
    listLayers: () => [...layers.values()],
    getLayerForTreeId: (id) =>
      [...layers.values()].find((layer) =>
        layer.bindings.some((binding) => String(binding.treeId) === String(id))
      ),
    getLayerIdForTypeName: (name) =>
      [...layers.values()].find((layer) => layer.typeName === name)?.id,
    update(config, nodes, origin = 'http://localhost') {
      const nextSignature = JSON.stringify([config, nodes]);
      if (nextSignature === signature) return;
      const next = new Map();
      const register = (typeName, label) => {
        typeName = qualify(typeName, config.workspace);
        const id = idFor(typeName);
        if (!next.has(id))
          next.set(id, { id, label, typeName, queryable: true, bindings: [] });
        return next.get(id);
      };
      for (const item of Object.values(config.pipelineLayers || {})) {
        for (const name of [item.line, item.point].filter(Boolean))
          register(name, item.displayName || item.name || name);
      }
      let service;
      try {
        service = new URL(config.baseUrl, origin);
      } catch {
        /* No valid service: map-only catalog. */
      }
      const visit = (node) => {
        if (node.children?.length) {
          node.children.forEach(visit);
          return;
        }
        if (node.id == null || node.children) return;
        let typeName = node.config?.layerName;
        let matches = !node.url && !!typeName;
        try {
          if (node.url || node.config?.baseUrl) {
            const url = new URL(node.url || node.config.baseUrl, origin);
            matches =
              service &&
              url.origin === service.origin &&
              (url.pathname === service.pathname ||
                url.pathname.startsWith(
                  service.pathname.replace(/\/$/, '') + '/'
                ));
            typeName ||= [...url.searchParams].find(
              ([key]) => key.toLowerCase() === 'layers'
            )?.[1];
          }
        } catch {
          matches = false;
        }
        const layer =
          matches && typeName && !typeName.includes(',')
            ? register(typeName.trim(), node.label)
            : {
                id: `map:${node.id}`,
                label: node.label,
                queryable: false,
                bindings: [],
              };
        // Existing XML loaders use the original XML ID as OpenLayers name.
        layer.bindings.push({
          treeId: node.id,
          engineName: node.engineName ?? node.config?.layerName ?? node.id,
        });
        next.set(layer.id, layer);
      };
      (nodes || []).forEach(visit);
      layers = next;
      signature = nextSignature;
      version++;
    },
  };
}
