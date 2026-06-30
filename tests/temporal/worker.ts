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
import { NativeConnection, Worker } from '@temporalio/worker';

import * as activities from './activities';
import { TASK_QUEUE, loadConnectionConfig } from './config';

/**
 * A created Worker together with the {@link NativeConnection} backing it. The
 * caller owns the connection and is responsible for closing it once the Worker
 * has stopped.
 */
export interface CreatedWorker {
  /** The Temporal Worker, ready to {@link Worker.run | run}. */
  worker: Worker;
  /** The connection backing the Worker; close it after the Worker stops. */
  connection: NativeConnection;
  /** The namespace the Worker is registered against, if one was configured. */
  namespace?: string;
}

/**
 * Connect to Temporal and create a Worker registered against the shared task
 * queue, Workflows and Activities.
 *
 * This is the single source of Worker configuration: both the normal entry
 * point ({@link run}) and the CI entry point (`worker-ci.ts`) build their
 * Worker from here, so there is no duplicated Worker setup.
 */
export async function createWorker(): Promise<CreatedWorker> {
  const { connectionOptions, namespace } = loadConnectionConfig();

  const connection = await NativeConnection.connect(connectionOptions);

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities,
  });

  console.log(
    `Worker ready: polling task queue "${TASK_QUEUE}" on namespace "${namespace ?? 'default'}"`,
  );

  return { worker, connection, namespace };
}

/**
 * Worker entry point. Creates the Worker via {@link createWorker} and polls the
 * configured task queue until the process is stopped. This behaviour is
 * unchanged: the normal Worker never shuts itself down.
 */
async function run(): Promise<void> {
  const { worker, connection } = await createWorker();

  try {
    await worker.run();
  } finally {
    await connection.close();
  }
}

// Only auto-run when this module is the process entry point, so that the CI
// Worker can import `createWorker` without starting a second Worker.
if (require.main === module) {
  run().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
