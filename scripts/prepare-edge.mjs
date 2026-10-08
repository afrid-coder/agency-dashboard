// Copies the server code into the Supabase function folder before deploying,
// so the function bundles exactly the code the Node server runs. The copies
// are build output (git-ignored); edit server/ and shared/, not these.
import { cpSync, rmSync } from 'node:fs';

const fn = new URL('../supabase/functions/api/', import.meta.url);
for (const dir of ['server', 'shared']) {
  const target = new URL(`${dir}/`, fn);
  rmSync(target, { recursive: true, force: true });
  cpSync(new URL(`../${dir}/`, import.meta.url), target, {
    recursive: true,
    // Node-only parts the API never loads on Supabase.
    filter: (src) => !/\/server\/(scripts|db\/migrations)(\/|$)|\/server\/index\.ts$|\/server\/db\/embedded\.ts$/.test(src),
  });
}
console.log('Copied server/ and shared/ into supabase/functions/api/.');
