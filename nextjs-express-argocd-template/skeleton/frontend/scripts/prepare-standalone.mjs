import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// `next build` emits a standalone server plus the traced node_modules, but it
// does not copy public/ or .next/static into .next/standalone. Doing it here
// means `npm start` can run the same server.js that the Docker image runs.
const standalone = '.next/standalone';

if (!existsSync(standalone)) {
  console.error(
    `[prepare-standalone] ${standalone} not found - run "npm run build" first.`,
  );
  process.exit(1);
}

await mkdir(`${standalone}/.next`, { recursive: true });
await cp('public', `${standalone}/public`, { recursive: true });
await cp('.next/static', `${standalone}/.next/static`, { recursive: true });
