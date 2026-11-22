'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface HealthPayload {
  status: string;
  service: string;
  version: string;
  timestamp: string;
}

interface Item {
  id: string;
  name: string;
  createdAt: string;
}

interface ItemsResponse {
  items: Item[];
}

export default function Home() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [healthResponse, itemsResponse] = await Promise.all([
        fetch('/api/health', { cache: 'no-store' }),
        fetch('/api/items', { cache: 'no-store' }),
      ]);

      if (!healthResponse.ok || !itemsResponse.ok) {
        throw new Error('The Express API returned an error.');
      }

      setHealth((await healthResponse.json()) as HealthPayload);
      setItems(((await itemsResponse.json()) as ItemsResponse).items);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not reach the API.',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }

    setPending(true);
    try {
      const response = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? 'Could not create the item.');
      }

      setName('');
      setError(null);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not create the item.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Next.js frontend · Express API</p>
        <h1>${{ values.componentId }}</h1>
        <p className="muted">${{ values.description }}</p>
      </header>

      <section className="grid">
        <article className="card">
          <h2>Backend health</h2>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          {health ? (
            <dl className="facts">
              <div>
                <dt>Status</dt>
                <dd>
                  <span
                    className={`badge ${
                      health.status === 'ok' ? 'ok' : 'error'
                    }`}
                  >
                    {health.status}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Service</dt>
                <dd>{health.service}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{health.version}</dd>
              </div>
              <div>
                <dt>Checked</dt>
                <dd>{health.timestamp}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">Loading…</p>
          )}
        </article>

        <article className="card">
          <h2>Express items API</h2>
          <p className="muted">
            In-memory demo CRUD served by Express at <code>/api/items</code>.
          </p>

          <form className="form" onSubmit={addItem}>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="New item name"
              maxLength={100}
              aria-label="New item name"
            />
            <button type="submit" disabled={pending || !name.trim()}>
              {pending ? 'Saving…' : 'Add'}
            </button>
          </form>

          <ul className="items">
            {items.length === 0 ? (
              <li className="muted">No items yet.</li>
            ) : (
              items.map((item) => (
                <li key={item.id}>
                  <span>{item.name}</span>
                  <span className="muted">#{item.id}</span>
                </li>
              ))
            )}
          </ul>
        </article>
      </section>

      <footer className="muted">
        Edit <code>frontend/app/page.tsx</code> for the UI, or{' '}
        <code>backend/src/app.ts</code> and <code>backend/src/routes/</code> to
        change the API.
      </footer>
    </main>
  );
}
