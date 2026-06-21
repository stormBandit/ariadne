import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/api/content', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM content ORDER BY created_at DESC'
  ).all();
  return c.json(results);
});

export default app;
