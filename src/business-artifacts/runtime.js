import {
  createBusinessCardApplication,
  DEFAULT_BASE_URL,
} from './application.js';

const applications = new Map();

export function getBusinessCardApplication({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl,
} = {}) {
  const key = `${baseUrl}`;
  if (fetchImpl) return createBusinessCardApplication({ baseUrl, fetchImpl });
  if (!applications.has(key))
    applications.set(key, createBusinessCardApplication({ baseUrl }));
  return applications.get(key);
}

export function resetBusinessCardApplicationsForTest() {
  applications.clear();
}
