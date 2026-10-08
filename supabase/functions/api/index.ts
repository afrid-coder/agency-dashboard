// Supabase Edge Function: the Lumera Creative API (server/app.ts), called by
// the web app on GitHub Pages. Deployed by .github/workflows/deploy.yml, which
// first copies server/ and shared/ next to this file (scripts/prepare-edge.mjs).
import process from 'node:process';
import { Buffer } from 'node:buffer';

// The server code is written for Node; make its globals available first.
const g = globalThis as Record<string, unknown>;
g.process ??= process;
g.Buffer ??= Buffer;

const { app } = await import('./server/app.ts');
Deno.serve(app.fetch);
