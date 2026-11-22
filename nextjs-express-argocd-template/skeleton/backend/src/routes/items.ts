import { Router } from 'express';

export interface Item {
  id: string;
  name: string;
  createdAt: string;
}

/**
 * In-memory demo store. It is intentionally simple: restarting the pod resets
 * the list. Replace it with a real database client when building a service that
 * needs persistence.
 */
const items = new Map<string, Item>();
let nextId = 0;

/** Test helper: clears the in-memory store between test cases. */
export function resetItems(): void {
  items.clear();
  nextId = 0;
}

function parseName(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const { name } = body as { name?: unknown };
  if (typeof name !== 'string') {
    return null;
  }

  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 100 ? trimmed : null;
}

export const itemsRouter: Router = Router();

itemsRouter.get('/', (_req, res) => {
  res.json({ items: [...items.values()] });
});

itemsRouter.post('/', (req, res) => {
  const name = parseName(req.body);
  if (!name) {
    res.status(400).json({
      error: 'name must be a non-empty string of at most 100 characters',
    });
    return;
  }

  nextId += 1;
  const item: Item = {
    id: String(nextId),
    name,
    createdAt: new Date().toISOString(),
  };
  items.set(item.id, item);

  res.status(201).json(item);
});

itemsRouter.get('/:id', (req, res) => {
  const item = items.get(req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Not Found' });
    return;
  }

  res.json(item);
});

itemsRouter.delete('/:id', (req, res) => {
  if (!items.delete(req.params.id)) {
    res.status(404).json({ error: 'Not Found' });
    return;
  }

  res.status(204).send();
});
