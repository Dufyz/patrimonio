import { ConflictError } from '@patrimonio/application';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createErrorHandler, notFoundHandler } from './error-handler.js';
import { requestContext } from './request-context.js';
import { validate } from './validate.js';

/** Uma app mínima: só a pilha de middlewares que está sob teste. */
const appWith = (
  configure: (app: express.Express) => void,
  options = { includeStack: true },
): express.Express => {
  const app = express();
  app.use(requestContext);
  app.use(express.json());
  configure(app);
  app.use(notFoundHandler);
  app.use(createErrorHandler(options));
  return app;
};

const schema = z.object({
  body: z.object({
    portfolio_id: z.string().uuid(),
    trade_date: z.string().date(),
  }),
  query: z.object({
    group_by: z.enum(['category', 'institution', 'none']).default('category'),
  }),
});

describe('validate', () => {
  it('payload inválido devolve 400 com o erro do zod', async () => {
    const app = appWith((instance) => {
      instance.post('/lancamentos', validate(schema), (_request, response) => {
        response.status(201).json({ ok: true });
      });
    });

    const response = await request(app)
      .post('/lancamentos')
      .send({ portfolio_id: 'não é uuid', trade_date: '10/03/2024' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Payload inválido');
    expect(response.body.request_id).toBeTruthy();
    expect(response.body.issues.map((issue: { path: string }) => issue.path)).toEqual([
      'body.portfolio_id',
      'body.trade_date',
    ]);
  });

  it('payload válido segue para o controller com o dado já convertido', async () => {
    const app = appWith((instance) => {
      instance.post('/lancamentos', validate(schema), (req, response) => {
        response.status(201).json({ body: req.body });
      });
    });

    const response = await request(app).post('/lancamentos').send({
      portfolio_id: '0191e5a0-0000-7000-8000-000000000001',
      trade_date: '2024-03-10',
    });

    expect(response.status).toBe(201);
    expect(response.body.body.trade_date).toBe('2024-03-10');
  });
});

describe('errorHandler', () => {
  it('AppError volta com o statusCode da hierarquia', async () => {
    const app = appWith((instance) => {
      instance.get('/conflito', () => {
        throw new ConflictError('carteira já existe');
      });
    });

    const response = await request(app).get('/conflito');

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('carteira já existe');
    expect(response.body.request_id).toBeTruthy();
  });

  it('erro inesperado volta 500 com requestId', async () => {
    const app = appWith((instance) => {
      instance.get('/explode', () => {
        throw new Error('algo que ninguém previu');
      });
    });

    const response = await request(app).get('/explode');

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Erro interno');
    expect(response.body.request_id).toBe(response.headers['x-request-id']);
  });

  it('em produção a stack não vai no corpo', async () => {
    const app = appWith(
      (instance) => {
        instance.get('/explode', () => {
          throw new Error('algo que ninguém previu');
        });
      },
      { includeStack: false },
    );

    const response = await request(app).get('/explode');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      message: 'Erro interno',
      request_id: response.headers['x-request-id'],
    });
    expect(JSON.stringify(response.body)).not.toContain('algo que ninguém previu');
  });
});
