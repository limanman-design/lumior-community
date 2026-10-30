import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { desktopDistribution } from '../runtime/distribution.cjs';

export function resolveDesktopBuildDistribution(args) {
  if (args.includes('--official') && args.includes('--community')) throw new Error('Choose one desktop distribution.');
  return args.includes('--official') ? 'official' : 'community';
}

export async function writeDistributionBuild(directory, distribution) {
  await writeFile(path.join(directory, 'distribution.json'), `${JSON.stringify({ schemaVersion: 1, distribution: desktopDistribution(distribution) })}\n`);
}

export async function verifyDistributionBuild(directory, expected) {
  desktopDistribution(expected);
  const filename = path.join(directory, 'distribution.json');
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw new Error('Invalid desktop distribution configuration.');
  const config = JSON.parse(await readFile(filename, 'utf8'));
  if (!config || Object.keys(config).sort().join(',') !== 'distribution,schemaVersion' || config.schemaVersion !== 1 || config.distribution !== expected) {
    throw new Error(`Prepare ${expected} desktop resources before packaging.`);
  }
  if (expected === 'community') {
    for (const name of ['trial-service.json', 'lumior-update-config.json', 'app-update.yml']) {
      try { await lstat(path.join(directory, name)); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      throw new Error('Community resources must not contain official service or updater configuration.');
    }
  }
}
