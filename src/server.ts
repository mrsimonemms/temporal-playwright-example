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
import formbody from '@fastify/formbody';
import fastifySecureSession from '@fastify/secure-session';
import fastifyView from '@fastify/view';
import fastify from 'fastify';
import pug from 'pug';

import { users } from './data/users';
import { type IUser } from './interfaces/users';

async function main(): Promise<void> {
  const server = fastify({
    logger: true,
  });

  // Order is important
  server
    .register(formbody)
    .register(fastifySecureSession, {
      // Hardcoded secret is fine for a demo, but not production
      secret: 'this is a super secret secure session key',
      salt: 'mq9hDxBVDbspDR6n',
      cookie: {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
      },
    })
    .register(fastifyView, {
      engine: {
        pug,
      },
    })
    .decorateRequest('user')
    .addHook('preHandler', (req, _, done) => {
      req.user = req.session.get('user');
      done();
    });

  server
    .get('/', (req, res) => {
      if (!req.user) {
        return res.redirect('/login');
      }

      return res.viewAsync('src/views/pages/index', {
        title: 'Homepage',
        user: req.user,
      });
    })
    .get('/login', (req, res) => {
      if (req.user) {
        return res.redirect('/');
      }

      const err = req.session.get('error');

      // Delete the error - treat as a flash message
      req.session.set('error', undefined);

      return res.viewAsync('src/views/pages/login', {
        title: 'Login',
        user: req.user,
        err,
      });
    })
    .post<{ Body: Omit<IUser, 'id' | 'name'> }>('/login', (req, res) => {
      // Yes, this is a dreadful way to check password. But this is a demo
      const user = users.find(
        (item) =>
          item.email === req.body.email && item.password === req.body.password,
      );

      if (user) {
        req.log.info({ user: user.email }, 'User logged in');
        req.session.user = user;
      } else {
        req.log.debug('Unknown user');
        req.session.error = 'Unknown email/password';
      }

      return res.redirect('/');
    })
    .get('/logout', async (req, res) => {
      req.session.regenerate();

      return res.redirect('/');
    });

  await server.listen({
    host: process.env.HOST ?? '0.0.0.0',
    port: Number(process.env.PORT ?? 3000),
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
