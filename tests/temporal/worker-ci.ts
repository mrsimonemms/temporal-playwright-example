/*
 * Copyright 2026 Simon Emms <simon@simonemms.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { type WorkflowExecutionStatusName } from '@temporalio/client';
import { WorkflowNotFoundError } from '@temporalio/common';

import { closeConnection, getClient } from './config';
import { createWorker } from './worker';

/**
 * Workflow ID this CI Worker watches. When it reaches a closed state the Worker
 * shuts itself down. Supplied by the CI pipeline so every Worker in the matrix
 * monitors the same suite Workflow.
 */
const WORKFLOW_ID = process.env.TEMPORAL_WORKFLOW_ID;

/**
 * How often to poll the monitored Workflow's status, in milliseconds.
 */
const POLL_INTERVAL_MS = 2000;

/**
 * Closed Workflow statuses that should trigger Worker shutdown. These are the
 * terminal states: once a Workflow reaches one, no further Activities will be
 * scheduled for it.
 */
const CLOSED_STATUSES: ReadonlySet<WorkflowExecutionStatusName> =
  new Set<WorkflowExecutionStatusName>([
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'TERMINATED',
    'TIMED_OUT',
  ]);

/**
 * Resolve after `ms` milliseconds. Used to space out status polls.
 */
function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Poll the monitored Workflow until it reaches a closed state, then resolve.
 *
 * The Workflow may not exist yet when the Worker starts: the starter job runs
 * independently, so a `WorkflowNotFoundError` simply means "not started yet" —
 * we keep waiting. Any other error is genuine and is propagated. While the
 * Workflow is still running we keep polling without interrupting anything.
 */
async function waitForWorkflowToClose(workflowId: string): Promise<void> {
  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);

  for (;;) {
    try {
      const { status } = await handle.describe();

      if (CLOSED_STATUSES.has(status.name)) {
        console.log(
          `Monitored Workflow "${workflowId}" reached closed state ` +
            `"${status.name}"; shutting the Worker down`,
        );
        return;
      }
    } catch (err: unknown) {
      // Not created yet — keep waiting rather than treating this as a failure.
      if (!(err instanceof WorkflowNotFoundError)) {
        throw err;
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * CI Worker entry point. Starts the same Worker as the normal entry point, but
 * runs it only until the monitored Workflow closes. `Worker.runUntil` then
 * performs Temporal's normal graceful shutdown: it stops polling for new work
 * and lets any in-flight Activity finish before resolving.
 */
async function run(): Promise<void> {
  if (!WORKFLOW_ID) {
    throw new Error(
      'TEMPORAL_WORKFLOW_ID must be set for the CI Worker so it knows which ' +
        'Workflow to monitor',
    );
  }

  const { worker, connection } = await createWorker();

  try {
    await worker.runUntil(waitForWorkflowToClose(WORKFLOW_ID));
  } finally {
    await connection.close();
    await closeConnection();
  }
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
