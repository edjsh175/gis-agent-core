/**
 * @typedef {{layerId:string,sourceFeatureId:string|number}} FeatureIdentity
 * Source identity is not a query snapshot and cannot be resolved implicitly.
 * @typedef {{resultId:string,indices?:number[]}} FeatureRef
 * @typedef {{userId:string,browserSessionId:string,threadId:string,workflowId:string,configVersion:string|number,leaseExpiresAt:number}} ReferenceBinding
 * @typedef {{center:number[],zoom:number,crs:'EPSG:4326'}} MapViewport
 * @typedef {{layerId:string,loaded:'complete'|'partial'|'none'|'ambiguous',visible:boolean|null}} ObservedLayer
 * @typedef {{count:number,identities:FeatureIdentity[],unidentifiedCount:number,truncated:boolean}} HighlightSummary
 * @typedef {object} MapContext
 * @property {1} schemaVersion
 * @property {number} revision Monotonic within this page's context reader.
 * @property {'2d'|'3d'} dimension
 * @property {boolean} ready Runtime readiness; does not imply supported tools.
 * @property {string[]} supportedTools Availability only, not authorization.
 * @property {MapViewport|null} viewport
 * @property {ObservedLayer[]|null} layers null means not observed, [] means observed empty.
 * @property {string[]|null} visibleLayers
 * @property {null} selection No authoritative selection provider is connected yet.
 * @property {{coverage:'capability',groups:Record<string,HighlightSummary>}|null} highlight
 */
export {};
