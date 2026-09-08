import * as shapefile from 'shapefile';
import { gisError } from '../contracts.js';

const assertNotAborted = (signal) => {
  if (signal?.aborted) throw gisError('OPERATION_CANCELLED');
};

async function readArrayBuffer(file, signal) {
  if (!file) throw gisError('INVALID_ARGUMENT', '缺少文件');
  assertNotAborted(signal);
  if (typeof file.arrayBuffer === 'function') {
    const value = await file.arrayBuffer();
    assertNotAborted(signal);
    return value;
  }
  if (typeof FileReader === 'undefined')
    throw gisError('FILE_READ_FAILED', '当前环境不支持文件读取');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => {
      try { reader.abort(); } catch { /* Reader may already be settled. */ }
      reject(gisError('OPERATION_CANCELLED'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    reader.onerror = () => reject(gisError('FILE_READ_FAILED'));
    reader.onabort = () => reject(gisError('OPERATION_CANCELLED'));
    reader.onload = () => resolve(reader.result);
    reader.onloadend = () => signal?.removeEventListener('abort', abort);
    reader.readAsArrayBuffer(file);
  });
}

/** Single SHP decoder used by both GIS Capability and the legacy UI wrapper. */
export async function readVectorDataset(dataset, { encoding = 'utf-8', signal } = {}) {
  if (!dataset || dataset.format !== 'shapefile')
    throw gisError('UNSUPPORTED_VECTOR_FORMAT');
  const [shpBuffer, dbfBuffer] = await Promise.all([
    readArrayBuffer(dataset.shpFile, signal),
    readArrayBuffer(dataset.dbfFile, signal),
  ]);
  assertNotAborted(signal);
  let source;
  try {
    source = await shapefile.open(shpBuffer, dbfBuffer, { encoding });
  } catch (error) {
    throw gisError('VECTOR_PARSE_FAILED', error?.message || 'SHP 解析失败');
  }
  const features = [];
  try {
    while (true) {
      assertNotAborted(signal);
      const result = await source.read();
      if (!result || result.done) break;
      if (result.value?.type === 'Feature' && result.value.geometry)
        features.push(result.value);
    }
  } catch (error) {
    throw gisError('VECTOR_PARSE_FAILED', error?.message || 'SHP 读取失败');
  }
  if (!features.length) throw gisError('EMPTY_VECTOR_DATASET', '矢量数据集没有可显示要素');
  return { name: dataset.name, features };
}
