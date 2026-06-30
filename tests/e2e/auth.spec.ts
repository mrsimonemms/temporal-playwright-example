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

import { users } from '../../src/data/users';
import { submitLogin } from '../setup/login';

// Each user is exercised independently so the cases can later be orchestrated
// one-by-one by Temporal Activities.
for (const user of users) {
  test(`successful login and logout for ${user.email}`, async ({ page }) => {
    // Visiting the homepage while logged out redirects to the login page.
    await page.goto('/');
    await expect(page).toHaveURL('/login');

    await submitLogin(page, user.email, user.password);

    // A successful login lands the user back on the homepage.
    await expect(page).toHaveURL('/');

    // The homepage shows the authenticated user's details.
    await expect(page.getByTestId('user-id')).toHaveText(String(user.id));
    await expect(page.getByTestId('user-name')).toHaveText(user.name);
    await expect(page.getByTestId('user-email')).toHaveText(user.email);

    // Logging out returns the user to the login page.
    await page.getByTestId('logout-button').click();
    await expect(page).toHaveURL('/login');
  });
}
