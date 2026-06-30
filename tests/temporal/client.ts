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
import { randomUUID } from 'node:crypto';

import { TASK_QUEUE, closeConnection, getClient } from './config';
import { discoverExecutions } from './discovery';
import { type RunSuiteInput, runSuiteWorkflow } from './workflows';

/**
 * Stable prefix for generated Workflow IDs. A unique suffix is appended so that
 * each run produces a readable, collision-free identifier.
 */
const WORKFLOW_ID_PREFIX = 'e2e-spec';

/**
 * Client/start entry point. Discovers the Playwright work to run, constructs the
 * execution plan, starts the Workflow on the shared task queue with that plan,
 * waits for it to complete, and prints the Workflow ID and its structured
 * result.
 *
 * Test discovery lives here, not in the Workflow: the client decides *what*
 * work exists, the Workflow orchestrates it and the Activities execute it.
 */
async function run(): Promise<void> {
  try {
    const client = await getClient();

    const executions = await discoverExecutions();
    const input: RunSuiteInput = { executions };
    const workflowId =
      process.env.TEMPORAL_WORKFLOW_ID ??
      `${WORKFLOW_ID_PREFIX}-${randomUUID()}`;

    const handle = await client.workflow.start(runSuiteWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [input],
    });

    console.log(
      `Started Workflow "${handle.workflowId}" with ${executions.length} ` +
        `execution(s)`,
    );

    const result = await handle.result();

    console.log(`Workflow "${handle.workflowId}" completed with result:`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeConnection();
  }
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
