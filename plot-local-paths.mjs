import { realpath } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { PLOT_SYNC_CONFIG } from './plot-sync-config.mjs';

export const LOCAL_PLOT_DIRECTORY = dirname(PLOT_SYNC_CONFIG.sourcePath);
export const LOCAL_EXPOSE_DIRECTORY = join(LOCAL_PLOT_DIRECTORY, 'Exposes');

// Fail closed on cloud paths, including aliases/symlinks and not-yet-created children.
export async function assertLocalPlotPath(value, home = homedir()) {
  const requested = resolve(value);
  const forbidden = [join(home, 'Documents'), join(home, 'Desktop'),
    join(home, 'Library', 'Mobile Documents'), join(home, 'Library', 'CloudStorage')];
  // macOS can expose the same directory via /var and /private/var.
  const realHome = await realpath(home).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return resolve(home);
  });
  forbidden.push(...['Documents','Desktop','Library/Mobile Documents','Library/CloudStorage'].map(sub=>join(realHome,sub)));
  const check = path => {
    if (forbidden.some(root => path === root || path.startsWith(root + sep))) {
      throw new Error('CLOUD_PATH_FORBIDDEN: Der Grundstücksworkflow benötigt einen lokalen Pfad außerhalb von Dokumente, Schreibtisch und Cloud-Speichern.');
    }
  };
  check(requested);
  let existing = requested;
  for (;;) {
    try { check(await realpath(existing)); break; }
    catch (error) {
      if (error.code !== 'ENOENT' || dirname(existing) === existing) throw error;
      existing = dirname(existing);
    }
  }
  return requested;
}
