export const name = 'gis-frontend-fake-provider';
export const inject = ['gisFrontend'];

function failed(code, message, kind = 'unknown') {
  return { ok: false, error: { code, message }, effect: { status: 'none', kind } };
}

export function apply(ctx) {
  const layers = new Map();
  const calls = [];
  let nextLayer = 0;

  const provider = {
    async execute(request) {
      if (request.signal?.aborted) {
        const error = new Error('GIS frontend fake provider was aborted.');
        error.code = 'GIS_FRONTEND_ABORTED';
        throw error;
      }
      const args = structuredClone(request.arguments);
      calls.push({ operation: request.operation, arguments: args });

      switch (request.operation) {
        case 'import_vector_dataset': {
          const layer_ref = `ul_h0_${++nextLayer}`;
          layers.set(layer_ref, {
            file_ref: args.file_ref,
            name: args.name ?? args.file_ref,
            visible: true,
            style: null,
          });
          return {
            ok: true,
            data: { layer_ref, name: args.name ?? args.file_ref },
            effect: { status: 'applied', kind: 'import' },
          };
        }
        case 'set_vector_style': {
          const layer = layers.get(args.layer_ref);
          if (!layer) return failed('UNKNOWN_LAYER_REF', 'The requested user vector layer does not exist.', 'style');
          layer.style = structuredClone(args.style);
          return { ok: true, data: { layer_ref: args.layer_ref }, effect: { status: 'applied', kind: 'style' } };
        }
        case 'fit_vector_layer': {
          if (!layers.has(args.layer_ref)) return failed('UNKNOWN_LAYER_REF', 'The requested user vector layer does not exist.', 'locate');
          return { ok: true, data: { layer_ref: args.layer_ref }, effect: { status: 'applied', kind: 'locate' } };
        }
        case 'set_user_layer_visibility': {
          const layer = layers.get(args.layer_ref);
          if (!layer) return failed('UNKNOWN_LAYER_REF', 'The requested user vector layer does not exist.', 'visibility');
          layer.visible = args.visible;
          return {
            ok: true,
            data: { layer_ref: args.layer_ref, visible: args.visible },
            effect: { status: 'applied', kind: 'visibility' },
          };
        }
        default:
          return failed('UNSUPPORTED_GIS_OPERATION', `Unsupported GIS operation: ${request.operation}`);
      }
    },
  };

  const disposeProvider = ctx.gisFrontend.registerProvider(provider);
  ctx.effect(() => () => disposeProvider(), 'gis fake provider lifecycle');
  ctx.provide('gisFrontendFake', {
    getCalls: () => structuredClone(calls),
    getLayer: (layerRef) => layers.has(layerRef) ? structuredClone(layers.get(layerRef)) : undefined,
  });
}
