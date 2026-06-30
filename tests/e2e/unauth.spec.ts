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
import { expect, test } from '@playwright/test';

import { submitLogin } from '../setup/login';

// Do as a separate spec to show the fan-out of each spec file
test('failed login shows an authentication error', async ({ page }) => {
  await page.goto('/login');

  await submitLogin(page, 'invalid@temporal.io', 'anypassword');

  // An invalid login keeps the user on the login page with an error message.
  await expect(page).toHaveURL('/login');
  await expect(page.getByTestId('login-error')).toBeVisible();
});
