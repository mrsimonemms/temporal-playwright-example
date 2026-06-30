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
import {
  ActivityFailure,
  ApplicationFailure,
  proxyActivities,
} from '@temporalio/workflow';

import type * as activities from './activities';
import {
  type BrowserProjectFailureDetail,
  type ExecuteBrowserProjectResult,
} from './activities';
import { type BrowserExecution } from './executions';

/**
 * Input for the {@link runSuiteWorkflow} Workflow.
 *
 * The Workflow no longer discovers anything: the client supplies the complete
 * collection of {@link BrowserExecution} work items and the Workflow simply
 * orchestrates them. Whether that list came from one spec fanned out across
 * browser projects, many spec files, Playwright shards or tagged groups is
 * entirely the client's concern.
 */
export interface RunSuiteInput {
  /** The executions to run, one Activity per item. */
  executions: BrowserExecution[];
}

/**
 * Structured description of a single browser project that failed after Temporal
 * exhausted every retry attempt. A collection of these is attached to the
 * {@link ApplicationFailure} the Workflow throws so the failure itself carries
 * enough information to see which browser(s) failed and why.
 */
export interface BrowserRunFailure {
  /** The spec that was executed. */
  spec: string;
  /** The Playwright browser project that failed. */
  project: string;
  /** Final, descriptive failure message. */
  failureMessage: string;
  /** Non-zero process exit code, when the failure carried Playwright detail. */
  exitCode?: number;
  /** The final Activity attempt (1-based) that failed, when known. */
  attempts?: number;
  /** Captured standard output from the final failing run, when known. */
  stdout?: string;
  /** Captured standard error from the final failing run, when known. */
  stderr?: string;
  /** Wall-clock duration of the final failing run, when known. */
  durationMs?: number;
}

/**
 * Structured `details` payload attached to the {@link ApplicationFailure} the
 * Workflow throws when one or more executions exhaust their retries.
 */
export interface PlaywrightSuiteFailureDetail {
  /** Total number of executions run. */
  total: number;
  /** Number of executions that passed. */
  passed: number;
  /** Number of executions that failed after exhausting retries. */
  failed: number;
  /** The individual per-execution failures (each carries its own spec/project). */
  failures: BrowserRunFailure[];
}

/**
 * Aggregated result returned by the {@link runSuiteWorkflow} Workflow. It is
 * only ever returned when every execution succeeded; any failure causes the
 * Workflow to throw instead of returning, so `success` is always `true` and
 * `failed` is always `0` on a returned result.
 */
export interface RunSuiteResult {
  /** Always `true` — a returned result means every execution succeeded. */
  success: boolean;
  /** Total number of executions run. */
  total: number;
  /** Number of executions that passed (`success: true`). */
  passed: number;
  /** Always `0` — failing executions fail the Workflow rather than being returned. */
  failed: number;
  /** The individual per-execution results, one per execution. */
  results: ExecuteBrowserProjectResult[];
}

/**
 * `type` set on the {@link ApplicationFailure} the Workflow throws when the
 * suite has one or more browser projects that exhausted their retries. A stable
 * type makes the suite-level failure easy to recognise programmatically.
 */
export const PLAYWRIGHT_SUITE_FAILURE = 'PlaywrightSuiteFailure';

/**
 * Proxy used to call Activities from the Workflow. A `startToCloseTimeout` is
 * required for every Activity invocation; it is generous here because a real
 * browser test (including starting the dev server) can take a while. This is
 * not a retry policy.
 */
const { executeBrowserProject } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '1m',
    maximumAttempts: 5,
  },
});

/**
 * Type guard for the structured detail attached to a Playwright failure. The
 * `details` of an {@link ApplicationFailure} are typed `unknown[]`, so the
 * shape is validated here before it is trusted — no casts required.
 */
function isBrowserProjectFailureDetail(
  value: unknown,
): value is BrowserProjectFailureDetail {
  return (
    typeof value === 'object' &&
    value !== null &&
    'spec' in value &&
    typeof value.spec === 'string' &&
    'project' in value &&
    typeof value.project === 'string' &&
    'exitCode' in value &&
    typeof value.exitCode === 'number' &&
    'stdout' in value &&
    typeof value.stdout === 'string' &&
    'stderr' in value &&
    typeof value.stderr === 'string' &&
    'durationMs' in value &&
    typeof value.durationMs === 'number' &&
    'attempt' in value &&
    typeof value.attempt === 'number'
  );
}

/**
 * Pull the {@link BrowserProjectFailureDetail} out of an error thrown by the
 * Activity. After retries are exhausted the proxy throws an
 * {@link ActivityFailure} whose `cause` is the original
 * {@link ApplicationFailure}; the detail lives in that failure's `details`.
 */
function extractFailureDetail(
  err: unknown,
): BrowserProjectFailureDetail | undefined {
  const cause = err instanceof ActivityFailure ? err.cause : err;

  if (cause instanceof ApplicationFailure) {
    const detail = cause.details?.[0];

    if (isBrowserProjectFailureDetail(detail)) {
      return detail;
    }
  }

  return undefined;
}

/**
 * Build a {@link BrowserRunFailure} from the error Temporal raises once a
 * browser project has exhausted all of its retries. The proxy throws an
 * {@link ActivityFailure} wrapping the original {@link ApplicationFailure}; the
 * inner message is the descriptive one ("Playwright project ... failed with
 * exit code ...") and the structured detail, when present, supplies the exit
 * code, captured output and final attempt number.
 */
function toBrowserRunFailure(
  execution: BrowserExecution,
  err: unknown,
): BrowserRunFailure {
  const { spec, project } = execution;
  const cause = err instanceof ActivityFailure ? err.cause : err;
  const failureMessage =
    cause instanceof Error
      ? cause.message
      : err instanceof Error
        ? err.message
        : String(err);
  const detail = extractFailureDetail(err);

  // A Playwright test failure carries full detail. Anything else (e.g. an
  // infrastructure failure) leaves us without captured output, so report the
  // minimal failure we do know about.
  if (detail) {
    return {
      spec: detail.spec,
      project: detail.project,
      failureMessage,
      exitCode: detail.exitCode,
      attempts: detail.attempt,
      stdout: detail.stdout,
      stderr: detail.stderr,
      durationMs: detail.durationMs,
    };
  }

  return {
    spec,
    project,
    failureMessage,
  };
}

/**
 * Deterministic Workflow that orchestrates a supplied collection of Playwright
 * executions end-to-end.
 *
 * It is a pure orchestrator: it discovers nothing and does no Playwright, shell,
 * timestamp or filesystem work itself. It fans out one Activity per supplied
 * {@link BrowserExecution}, lets Temporal retry and run them concurrently, and
 * waits for every one of them to finish. If they all eventually succeed it
 * returns an aggregated result. If one or more executions exhaust their retries
 * it throws an {@link ApplicationFailure} — so the Workflow itself fails —
 * carrying a {@link PlaywrightSuiteFailureDetail} that records which
 * execution(s) failed and why. All the non-deterministic work lives in
 * {@link executeBrowserProject}; deciding *what* to run is the client's job.
 */
export async function runSuiteWorkflow(
  input: RunSuiteInput,
): Promise<RunSuiteResult> {
  const { executions } = input;

  // Start every execution up-front so they run concurrently, then wait for all
  // of them to settle. `allSettled` (not `all`) ensures we wait for every
  // execution to finish — including its retries — before deciding the suite's
  // outcome, rather than bailing out on the first one to fail.
  const settled = await Promise.allSettled(
    executions.map((execution) =>
      executeBrowserProject.executeWithOptions(
        {
          summary: `${execution.spec}: ${execution.project}`,
        },
        [execution],
      ),
    ),
  );

  const results: ExecuteBrowserProjectResult[] = [];
  const failures: BrowserRunFailure[] = [];

  settled.forEach((outcome, index) => {
    const execution = executions[index];

    if (outcome.status === 'fulfilled') {
      results.push(outcome.value);
    } else {
      failures.push(toBrowserRunFailure(execution, outcome.reason));
    }
  });

  // Any execution that exhausted its retries must fail the whole Workflow.
  // Throw an ApplicationFailure whose details capture every failed execution,
  // so the Workflow does not silently complete with `success: false`.
  if (failures.length > 0) {
    const detail: PlaywrightSuiteFailureDetail = {
      total: executions.length,
      passed: results.length,
      failed: failures.length,
      failures,
    };

    throw ApplicationFailure.create({
      message:
        `${failures.length} of ${executions.length} execution(s) failed ` +
        `after exhausting all retries: ` +
        failures
          .map((failure) => `${failure.spec} (${failure.project})`)
          .join(', '),
      type: PLAYWRIGHT_SUITE_FAILURE,
      nonRetryable: true,
      details: [detail],
    });
  }

  return {
    success: true,
    total: executions.length,
    passed: results.length,
    failed: failures.length,
    results,
  };
}
