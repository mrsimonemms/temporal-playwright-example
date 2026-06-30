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
import fg from 'fast-glob';

import { type BrowserExecution } from './executions';

/**
 * The Playwright browser projects fanned out for each spec. These match the
 * project names declared in `playwright.config.ts`.
 *
 * This lives on the client side deliberately: deciding *which* browser projects
 * to run is part of discovering the work, not orchestrating it. The Workflow no
 * longer knows browser projects exist — it only sees the executions this
 * produces.
 */
const BROWSER_PROJECTS = ['chromium', 'firefox', 'webkit'] as const;

/**
 * Spec executed when none is supplied. The authentication spec is the existing
 * end-to-end test, so it is the natural default.
 */
const DEFAULT_GLOB = 'tests/e2e/**/*.spec.ts';

/**
 * Resolve which Playwright spec(s) to run. Precedence is: first CLI argument,
 * then the `PLAYWRIGHT_SPEC` environment variable, then the default spec.
 *
 * A list is returned even though the demonstration only ever resolves a single
 * spec: this is the seam where richer discovery slots in later (globbing the
 * `tests/e2e` directory, reading a manifest, expanding tagged groups) without
 * anything downstream having to change.
 */
async function resolveSpecs(): Promise<string[]> {
  const cliSpec = process.argv.length > 2 ? process.argv[2] : undefined;
  const spec = cliSpec ?? process.env.PLAYWRIGHT_SPEC ?? DEFAULT_GLOB;

  return (await fg(spec)).sort();
}

/**
 * Discover the collection of {@link BrowserExecution} work items to run.
 *
 * This is the client's responsibility: it decides *what* work exists before the
 * Workflow is started. Today it reproduces the existing demonstration exactly —
 * the resolved spec fanned out across every browser project — but it is
 * structured so that future discovery can expand naturally to multiple spec
 * files, Playwright shards or tagged test groups. Each of those simply produces
 * more {@link BrowserExecution}s; the Workflow and Activity contracts are
 * untouched.
 */
export async function discoverExecutions(): Promise<BrowserExecution[]> {
  const specs = await resolveSpecs();

  return specs.flatMap((spec) =>
    BROWSER_PROJECTS.map((project) => ({ spec, project })),
  );
}
