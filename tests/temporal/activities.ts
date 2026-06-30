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
import { ApplicationFailure, Context } from '@temporalio/activity';
import { spawn } from 'node:child_process';
import { type AddressInfo, createServer } from 'node:net';

import { type BrowserExecution } from './executions';

/**
 * `type` used on the {@link ApplicationFailure} thrown when Playwright reports a
 * test failure (non-zero exit code). Having a stable type makes the failure
 * easy to recognise and, if ever needed, to mark non-retryable via a
 * `RetryPolicy`.
 */
export const PLAYWRIGHT_TEST_FAILURE = 'PlaywrightTestFailure';

/**
 * Structured payload attached to a Playwright failure's {@link
 * ApplicationFailure} via its `details`. It carries everything needed to
 * reconstruct an {@link ExecuteBrowserProjectResult} in the Workflow once
 * Temporal has exhausted all retry attempts, so a flaky browser can be reported
 * as a failed run without failing the whole suite.
 */
export interface BrowserProjectFailureDetail {
  /** The spec that was executed. */
  spec: string;
  /** The Playwright browser project that was executed. */
  project: string;
  /** Non-zero process exit code reported by the Playwright run. */
  exitCode: number;
  /** Captured standard output from the failing Playwright run. */
  stdout: string;
  /** Captured standard error from the failing Playwright run. */
  stderr: string;
  /** Wall-clock duration of the failing run, in milliseconds. */
  durationMs: number;
  /** The Activity attempt (1-based) that produced this failure. */
  attempt: number;
}

/**
 * Structured result returned by the {@link executeBrowserProject} Activity.
 */
export interface ExecuteBrowserProjectResult {
  /** The spec that was executed. */
  spec: string;
  /** The Playwright browser project that was executed. */
  project: string;
  /** `true` when Playwright exited cleanly (exit code 0), `false` otherwise. */
  success: boolean;
  /** Process exit code reported by the Playwright run. */
  exitCode: number;
  /** Captured standard output from the Playwright run. */
  stdout: string;
  /** Captured standard error from the Playwright run. */
  stderr: string;
  /** Wall-clock duration of the run, in milliseconds. */
  durationMs: number;
}

/**
 * The npm command and leading arguments used to invoke Playwright.
 *
 * Playwright is run via the existing `npm test` script (`playwright test`)
 * rather than the programmatic API, so the Activity exercises the exact same
 * command a developer would run locally. The spec path, `--project` and
 * `--workers` flags are appended after the `--` separator so npm forwards them
 * straight to Playwright.
 */
const NPM_COMMAND = 'npm';
const NPM_ARGS = ['run', 'test', '--'];

/**
 * Default simulated flaky failure probability: disabled, so Playwright runs on
 * every attempt unless `PLAYWRIGHT_SIMULATED_FLAKY_PERCENTAGE` opts in.
 */
const DEFAULT_SIMULATED_FLAKY_PERCENTAGE = 0;

/** Inclusive bounds the configured failure percentage is clamped into. */
const MIN_FLAKY_PERCENTAGE = 0;
const MAX_FLAKY_PERCENTAGE = 100;

/**
 * Exit code reported on a simulated flaky failure. It is non-zero so the failure
 * is indistinguishable, to the retry machinery, from a genuine Playwright test
 * failure.
 */
const SIMULATED_FLAKY_EXIT_CODE = 1;

/**
 * Resolve the configured probability (as an integer percentage) that an Activity
 * attempt should be failed on purpose. Reads
 * `PLAYWRIGHT_SIMULATED_FLAKY_PERCENTAGE`; falls back to
 * {@link DEFAULT_SIMULATED_FLAKY_PERCENTAGE} when unset or not a valid integer,
 * and clamps any parsed value into `0–100`.
 */
function simulatedFlakyPercentage(): number {
  const raw = process.env.PLAYWRIGHT_SIMULATED_FLAKY_PERCENTAGE;

  if (raw === undefined) {
    return DEFAULT_SIMULATED_FLAKY_PERCENTAGE;
  }

  const parsed = Number.parseInt(raw, 10);

  if (Number.isNaN(parsed)) {
    return DEFAULT_SIMULATED_FLAKY_PERCENTAGE;
  }

  return Math.min(MAX_FLAKY_PERCENTAGE, Math.max(MIN_FLAKY_PERCENTAGE, parsed));
}

/**
 * Allocate a free TCP port on the local machine.
 *
 * A server is bound to port `0`, which tells the OS to pick any currently
 * available port; we read the chosen port back and immediately release the
 * socket so the application process can bind it. Allocating a fresh port per
 * Activity execution is what lets many Activities — even multiple copies of the
 * same browser project — run concurrently on one machine without colliding on a
 * shared port. The browser project name is never used to derive the port.
 */
function allocatePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.on('error', reject);

    server.listen(0, () => {
      const address: AddressInfo | string | null = server.address();

      if (address === null || typeof address === 'string') {
        server.close(() => {
          reject(new Error('Failed to allocate a TCP port'));
        });
        return;
      }

      const { port } = address;

      server.close((closeErr) => {
        if (closeErr) {
          reject(closeErr);
          return;
        }

        resolve(port);
      });
    });
  });
}

/**
 * Execute a single Playwright browser project for a single spec by shelling out
 * to the project's npm test script and capturing its output.
 *
 * The Activity is the unit of browser work: it runs exactly one browser project
 * (`chromium`, `firefox` or `webkit`) for one spec. Parallelism across browser
 * projects is provided by Temporal — the Workflow fans out one Activity per
 * project — so Playwright itself is forced to a single worker with
 * `--workers=1`.
 *
 * Each execution owns an isolated application instance: it dynamically
 * allocates a free local port, tells the application to listen on it (`PORT`)
 * and tells Playwright the matching base URL (`PLAYWRIGHT_BASE_URL`). Because
 * the port is allocated per execution rather than per browser, the Activity is
 * a self-contained unit of work that can run alongside any number of other
 * Activities on the same machine, or on a different machine entirely, with no
 * shared runtime assumptions. The application instance is started and torn down
 * by Playwright's own `webServer` management, so no extra cleanup is required
 * here.
 *
 * This is the right place for this work: spawning a process, reading the clock
 * and touching the filesystem are all non-deterministic, and Activities are
 * where non-deterministic work belongs.
 *
 * A failing Playwright test (non-zero exit code) is thrown as a *retryable*
 * {@link ApplicationFailure} so Temporal automatically retries it — the whole
 * point of this proof of concept is to ride out flaky browser tests. The
 * failure carries a {@link BrowserProjectFailureDetail} in its `details` so the
 * Workflow can surface exactly which browser failed and why once retries are
 * exhausted. Infrastructure failures (the process could not be spawned, or it
 * was terminated by a signal without ever producing an exit code) are also
 * thrown, and are likewise retryable.
 *
 * To demonstrate retries without relying on a genuinely flaky test, each
 * attempt has a configurable probability of being failed on purpose before the
 * real Playwright run proceeds. See `PLAYWRIGHT_SIMULATED_FLAKY_PERCENTAGE`.
 */
export async function executeBrowserProject(
  input: BrowserExecution,
): Promise<ExecuteBrowserProjectResult> {
  const { spec, project } = input;

  // Captured synchronously, inside the Activity's context, so it is available
  // to the later `close` callback without depending on async-local propagation.
  const { attempt } = Context.current().info;

  // Probabilistic flaky-test demonstration: with the configured probability,
  // fail this attempt before running Playwright so Temporal visibly retries. The
  // outcome is rolled independently per attempt.
  const flakyPercentage = simulatedFlakyPercentage();

  if (flakyPercentage > 0 && Math.random() * 100 < flakyPercentage) {
    const detail: BrowserProjectFailureDetail = {
      spec,
      project,
      exitCode: SIMULATED_FLAKY_EXIT_CODE,
      stdout: '',
      stderr:
        `Simulated flaky failure for project "${project}" on attempt ` +
        `${attempt} (configured ${flakyPercentage}% failure probability); the ` +
        `run will be retried.`,
      durationMs: 0,
      attempt,
    };

    throw ApplicationFailure.create({
      message:
        `Simulated flaky failure for project "${project}" (attempt ` +
        `${attempt}, ${flakyPercentage}% probability); retrying to ` +
        `demonstrate Temporal retries`,
      type: PLAYWRIGHT_TEST_FAILURE,
      nonRetryable: false,
      details: [detail],
    });
  }

  const port = await allocatePort();
  const baseUrl = `http://localhost:${port}`;
  const startedAt = Date.now();

  return new Promise<ExecuteBrowserProjectResult>((resolve, reject) => {
    const child = spawn(
      NPM_COMMAND,
      [...NPM_ARGS, spec, `--project=${project}`, '--workers=1'],
      {
        cwd: process.cwd(),
        // Give this execution its own application instance: the app listens on
        // the allocated port and Playwright reaches it via the matching URL.
        env: {
          ...process.env,
          PORT: String(port),
          PLAYWRIGHT_BASE_URL: baseUrl,
        },
      },
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Fired when the process could not be started at all (e.g. npm missing).
    // This is an infrastructure failure, so surface it as a thrown error.
    child.on('error', (err: Error) => {
      reject(err);
    });

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      const durationMs = Date.now() - startedAt;

      // A null exit code means the process was killed by a signal before it
      // could finish: it did not complete meaningfully, so this is an error.
      if (code === null) {
        reject(
          new Error(
            `Playwright run for spec "${spec}" (project "${project}") was ` +
              `terminated by signal ${signal ?? 'unknown'} without producing ` +
              `an exit code`,
          ),
        );
        return;
      }

      // A non-zero exit code is a Playwright test failure. Throw it as a
      // retryable ApplicationFailure so Temporal retries the browser run, and
      // attach the structured detail needed to rebuild the result afterwards.
      if (code !== 0) {
        const detail: BrowserProjectFailureDetail = {
          spec,
          project,
          exitCode: code,
          stdout,
          stderr,
          durationMs,
          attempt,
        };

        reject(
          ApplicationFailure.create({
            message:
              `Playwright project "${project}" failed for spec "${spec}" ` +
              `with exit code ${code} (attempt ${attempt})`,
            type: PLAYWRIGHT_TEST_FAILURE,
            nonRetryable: false,
            details: [detail],
          }),
        );
        return;
      }

      resolve({
        spec,
        project,
        success: true,
        exitCode: code,
        stdout,
        stderr,
        durationMs,
      });
    });
  });
}
