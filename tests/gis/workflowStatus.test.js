import { describe, expect, it } from 'vitest';
import { isWorkflowBusy } from '../../src/gis/integration/agui/workflowStatus.js';

describe('workflow status', () => {
  it('treats every active workflow phase as busy', () => {
    for (const status of [
      'connecting',
      'running',
      'waiting_frontend',
      'waiting_result_submission',
      'explaining_failure',
    ]) {
      expect(isWorkflowBusy(status)).toBe(true);
    }
  });

  it('keeps terminal and idle phases available', () => {
    for (const status of ['idle', 'completed', 'failed', 'cancelled']) {
      expect(isWorkflowBusy(status)).toBe(false);
    }
  });
});
