import { success, asFailure, gisError } from '../contracts.js';

const DEFAULT_ID_FACTORY = () => `vf_${crypto.randomUUID()}`;

function splitFileName(file) {
  if (!file || typeof file.name !== 'string' || !file.name.trim())
    throw gisError('INVALID_ARGUMENT', '文件缺少有效名称');
  const match = /^(.*)\.([^.]+)$/.exec(file.name.trim());
  if (!match) throw gisError('INVALID_ARGUMENT', '文件缺少扩展名');
  return { base: match[1], extension: match[2].toLowerCase() };
}

export function matchShapefilePair(input) {
  const files = Array.from(input || []);
  if (files.length !== 2)
    throw gisError('INVALID_ARGUMENT', '首版 SHP 导入需要同时选择 .shp 与 .dbf');
  const indexed = files.map((file) => ({ file, ...splitFileName(file) }));
  const shp = indexed.find((item) => item.extension === 'shp');
  const dbf = indexed.find((item) => item.extension === 'dbf');
  if (!shp || !dbf || shp.base.toLowerCase() !== dbf.base.toLowerCase())
    throw gisError('INVALID_ARGUMENT', '.shp 与 .dbf 必须同名配对');
  return { name: shp.base, shpFile: shp.file, dbfFile: dbf.file };
}

/** Browser-owned File/Blob references. Only opaque file_ref values cross into Agent state. */
export function createFileReferenceStore({ idFactory = DEFAULT_ID_FACTORY } = {}) {
  const records = new Map();
  return {
    registerVectorDataset(files) {
      try {
        const pair = matchShapefilePair(files);
        const fileRef = idFactory();
        if (typeof fileRef !== 'string' || !fileRef || records.has(fileRef))
          throw gisError('REFERENCE_ALLOCATION_FAILED');
        const record = {
          file_ref: fileRef,
          name: pair.name,
          format: 'shapefile',
          parts: ['shp', 'dbf'],
          dataset: {
            format: 'shapefile',
            name: pair.name,
            shpFile: pair.shpFile,
            dbfFile: pair.dbfFile,
          },
        };
        records.set(fileRef, record);
        return success({
          file_ref: record.file_ref,
          name: record.name,
          format: record.format,
          parts: [...record.parts],
        });
      } catch (error) {
        return asFailure(error, 'INVALID_ARGUMENT');
      }
    },
    resolve(fileRef) {
      try {
        if (typeof fileRef !== 'string' || !fileRef)
          throw gisError('INVALID_ARGUMENT');
        const record = records.get(fileRef);
        if (!record) throw gisError('FILE_REF_EXPIRED');
        return success({ dataset: record.dataset });
      } catch (error) {
        return asFailure(error);
      }
    },
    list() {
      return [...records.values()].map(({ dataset: _dataset, ...summary }) => ({
        ...summary,
        parts: [...summary.parts],
      }));
    },
    revoke(fileRef) {
      return records.delete(fileRef);
    },
    clear() {
      records.clear();
    },
  };
}
