import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const label = 'com.fabianpascal.inseratstudio.helper';

export function validateInstalledHelperPath(entry, runtimeParent) {
  const root = resolve(runtimeParent);
  const target = resolve(entry);
  if (!target.startsWith(root + sep) || !/^release-[^/]+\/local-helper-launcher\.mjs$/.test(target.slice(root.length + 1))) {
    throw new Error('Der Startknopf verweigert einen Helper außerhalb der installierten Release-Runtime.');
  }
  return target.slice(0, -'/local-helper-launcher.mjs'.length);
}

export async function launchInstalledStudio() {
  const dataRoot = join(homedir(), 'Library', 'Application Support', 'Fabian-Pascal Inseratestudio');
  const agent = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  const {stdout} = await execute('/usr/bin/plutil', ['-extract', 'ProgramArguments', 'json', '-o', '-', agent]);
  const args = JSON.parse(stdout);
  const runtime = validateInstalledHelperPath(await realpath(args[1]), join(dataRoot, 'helper-runtime'));
  const manifest = JSON.parse(await readFile(join(runtime, 'helper-runtime-manifest.json'), 'utf8'));
  if (!manifest.includesBuiltUi || !/^[a-f0-9]{40}$/.test(manifest.runtimeCommit)) throw new Error('Die installierte Release-Runtime enthält noch keine geprüfte Oberfläche.');
  const token = (await readFile(join(dataRoot, 'helper-session'), 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Die lokale Sitzung ist ungültig.');
  const domain = `gui/${process.getuid()}`;
  try { await execute('/bin/launchctl', ['print', `${domain}/${label}`]); }
  catch { await execute('/bin/launchctl', ['bootstrap', domain, agent]); }

  let healthy = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:43182/health', {headers:{'X-FPI-Session':token},signal:AbortSignal.timeout(1000)});
      if (response.ok) {
        const health = await response.json();
        if (health.runtimeCommit !== manifest.runtimeCommit || health.runtimeRelease !== manifest.releaseId) throw new Error('RUNTIME_MISMATCH');
        healthy = true; break;
      }
    } catch(error) { if(error.message === 'RUNTIME_MISMATCH') throw new Error('Ein fremder Helper belegt Port 43182. Kein zweiter Helper wurde gestartet.'); }
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
  }
  if (!healthy) throw new Error('Die autorisierte Helper-Runtime ist nicht erreichbar. Kein Working-Directory-Helper wird gestartet.');
  const uiLabel = 'com.fabianpascal.inseratstudio.ui';
  const uiAgent = join(homedir(), 'Library', 'LaunchAgents', `${uiLabel}.plist`);
  const uiArgs = JSON.parse((await execute('/usr/bin/plutil', ['-extract','ProgramArguments','json','-o','-',uiAgent])).stdout);
  if (await realpath(uiArgs[1]) !== join(runtime, 'production-server.mjs')) throw new Error('Oberfläche und Helper gehören nicht zur selben Release-Runtime.');
  try { await execute('/bin/launchctl', ['print', `${domain}/${uiLabel}`]); }
  catch { await execute('/bin/launchctl', ['bootstrap',domain,uiAgent]); }
  for(let attempt=0;attempt<20;attempt++) {
    try {
      const response=await fetch('http://127.0.0.1:43181/__fpi_health',{signal:AbortSignal.timeout(1000)});
      if(response.ok && await response.text()==='fabian-pascal-inseratestudio') {
        await execute('/usr/bin/open',['-a','Google Chrome',`http://127.0.0.1:43181/#session=${token}`]);
        return;
      }
    } catch { /* The LaunchAgent can still be starting. */ }
    await new Promise(resolveWait=>setTimeout(resolveWait,500));
  }
  throw new Error('Die Oberfläche ist nicht erreichbar. Bitte die lokalen UI-Logs prüfen.');
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  launchInstalledStudio().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
}
