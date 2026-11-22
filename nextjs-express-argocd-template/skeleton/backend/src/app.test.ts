import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { resetItems } from './routes/items';

const app = createApp();

beforeEach(() => {
  resetItems();
});

describe('GET /api/health', () => {
  it('reports the service as healthy', async () => {
    const response = await request(app).get('/api/health').expect(200);

    expect(response.body).toMatchObject({ status: 'ok' });
    expect(typeof response.body.timestamp).toBe('string');
  });
});

describe('items API', () => {
  it('returns an empty list initially', async () => {
    const response = await request(app).get('/api/items').expect(200);

    expect(response.body).toEqual({ items: [] });
  });

  it('creates, reads and deletes an item', async () => {
    const created = await request(app)
      .post('/api/items')
      .send({ name: 'first item' })
      .expect(201);

    expect(created.body).toMatchObject({ id: '1', name: 'first item' });

    const list = await request(app).get('/api/items').expect(200);
    expect(list.body.items).toHaveLength(1);

    const fetched = await request(app).get('/api/items/1').expect(200);
    expect(fetched.body.name).toBe('first item');

    await request(app).delete('/api/items/1').expect(204);
    await request(app).get('/api/items/1').expect(404);
  });

  it('rejects invalid payloads', async () => {
    await request(app).post('/api/items').send({ name: '   ' }).expect(400);
    await request(app).post('/api/items').send({}).expect(400);
  });

  it('returns a JSON 400 for malformed JSON', async () => {
    const response = await request(app)
      .post('/api/items')
      .set('Content-Type', 'application/json')
      .send('{"name":')
      .expect(400);

    expect(response.body).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns JSON for unknown API routes', async () => {
    const response = await request(app).get('/api/nope').expect(404);

    expect(response.body).toEqual({ error: 'Not Found' });
  });
});
