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
import { Client, Connection } from '@temporalio/client';
import { loadClientConnectConfig } from '@temporalio/envconfig';
import { type ClientConnectConfig } from '@temporalio/envconfig';

/**
 * Default task queue used by the Worker and the Workflow starter. The same
 * value must be used by both sides so that the Worker actually polls for the
 * Workflows the client schedules.
 */
const DEFAULT_TASK_QUEUE = 'temporal-playwright-example';

/**
 * Shared task queue. Overridable via the `TEMPORAL_TASK_QUEUE` environment
 * variable so that different environments can be isolated without code changes.
 */
export const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? DEFAULT_TASK_QUEUE;

/**
 * Load the Temporal connection configuration from the environment.
 *
 * All connection details (address, namespace, API key and TLS) are resolved by
 * `@temporalio/envconfig` from environment variables and/or a TOML config file
 * (see {@link https://docs.temporal.io/develop/environment-configuration}). No
 * Temporal Cloud address, namespace, API key or TLS material is hardcoded here.
 */
export function loadConnectionConfig(): ClientConnectConfig {
  return loadClientConnectConfig();
}

let connection: Connection | undefined;
let client: Client | undefined;

/**
 * Return a lazily-created, shared {@link Client}. The underlying
 * {@link Connection} is established on first use and reused thereafter.
 */
export async function getClient(): Promise<Client> {
  if (!client) {
    const { connectionOptions, namespace } = loadConnectionConfig();
    connection = await Connection.connect(connectionOptions);
    client = new Client({ connection, namespace });
  }

  return client;
}

/**
 * Close the shared {@link Connection}, if one has been opened, and reset the
 * shared client. Allows a short-lived process (such as the starter) to exit
 * cleanly once its work is done.
 */
export async function closeConnection(): Promise<void> {
  if (connection) {
    await connection.close();
    connection = undefined;
    client = undefined;
  }
}
