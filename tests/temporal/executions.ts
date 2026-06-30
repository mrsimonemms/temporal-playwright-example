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

/**
 * A single, self-contained unit of Playwright work.
 *
 * This is the strongly-typed work item that flows through the whole system:
 * the client *discovers* a collection of these, the Workflow *orchestrates*
 * them (one Activity per execution) and the Activity *executes* exactly one.
 *
 * It is deliberately the smallest thing that can be run independently — one
 * spec against one browser project. Because it is just plain data, it is safe
 * to import into the Workflow sandbox (this module has no runtime code) and it
 * can be constructed by any discovery strategy the client chooses without the
 * Workflow or Activity contracts having to change.
 *
 * Future discovery can expand *how many* of these are produced — multiple spec
 * files, Playwright shards, tagged test groups — by adding fields here (e.g. a
 * shard index or grep tag) and populating them client-side. The orchestration
 * remains "run one Activity per execution".
 */
export interface BrowserExecution {
  /** Path to the Playwright spec to run, e.g. `tests/e2e/auth.spec.ts`. */
  spec: string;
  /** Playwright browser project to run, e.g. `chromium`, `firefox`, `webkit`. */
  project: string;
}
