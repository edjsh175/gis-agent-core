/**
 * @template T
 * @typedef {{ok:true,data:T}|{ok:false,error:{code:string,message:string,details?:object}}} Result
 * @typedef {{type:'Feature',layerId:string,sourceFeatureId:string|number|null,properties:object,geometry:object|null}} CapabilityFeature
 * @typedef {{id:string,label:string,queryable:boolean,typeName?:string,bindings:Array<{treeId:string|number,engineName:string|number}>}} RegisteredLayer
 * @typedef {{layerId:string,filters:Array<{field:string,op:'eq',value:string|number|boolean}>,limit?:number}} QueryInput
 * @typedef {{features:CapabilityFeature[],returnedCount:number,truncated:boolean|null,crs:'EPSG:4326'}} QueryResult
 * @typedef {{features:CapabilityFeature[],group?:'results'|'selection',mode?:'replace'|'append',effect?:'persistent'|'blink'}} HighlightInput
 * @typedef {object} DataCapabilities
 * @property {()=>Promise<Result<{layers:Array<{id:string,label:string,queryable:boolean}>}>>} listLayers
 * @property {(input:QueryInput,options?:{signal?:AbortSignal})=>Promise<Result<QueryResult>>} queryFeatures
 * @typedef {object} ClientCapabilities
 * @property {(input:{features:CapabilityFeature[]})=>Promise<Result<{featureCount:number}>>} locateFeatures
 * @property {(input:HighlightInput)=>Promise<Result<{featureCount:number,group:string}>>} highlightFeatures
 * @property {(input?:{group?:'results'|'selection'})=>Promise<Result<{clearedCount:number}>>} clearHighlight
 * @property {(input:{layerId:string,visible:boolean})=>Promise<Result<{layerId:string,visible:boolean,bindingCount:number}>>} setLayerVisibility
 * @property {()=>boolean} isActive
 * @property {()=>void} dispose
 */
export const success = (data) => ({ ok: true, data });
export function failure(code, message = code, details) {
  return {
    ok: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
  };
}
export function gisError(code, message = code) {
  return Object.assign(new Error(message), { code });
}
export function asFailure(error, fallback = 'MAP_OPERATION_FAILED') {
  return failure(error.code || fallback, error.message);
}
