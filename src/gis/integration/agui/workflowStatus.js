const BUSY_WORKFLOW_STATUSES = Object.freeze([
  'connecting',
  'running',
  'waiting_frontend',
  'waiting_result_submission',
  'explaining_failure',
]);

const BUSY_STATUS_SET = new Set(BUSY_WORKFLOW_STATUSES);

export function isWorkflowBusy(status) {
  return BUSY_STATUS_SET.has(status);
}

export { BUSY_WORKFLOW_STATUSES };
