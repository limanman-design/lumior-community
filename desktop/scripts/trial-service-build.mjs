import { lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import trialAccess from '../runtime/trial-access.cjs';

const { normalizeTrialGatewayUrl, readTrialService } = trialAccess;

export async function resolveTrialServiceBuild(runtimeDirectory, { environment = process.env } = {}) {
  if (Object.hasOwn(environment, 'LUMIOR_TRIAL_GATEWAY_URL')) {
    return normalizeTrialGatewayUrl(environment.LUMIOR_TRIAL_GATEWAY_URL);
  }
  // The reviewed runtime file contains only the public production origin.
  const gatewayUrl = await readTrialService(runtimeDirectory, { environment: {} });
  if (!gatewayUrl) throw new Error('Desktop trial service is missing. Restore runtime/trial-service.json or set LUMIOR_TRIAL_GATEWAY_URL to the approved production origin.');
  return gatewayUrl;
}

export async function writeTrialServiceBuild(generatedDirectory, gatewayUrl) {
  const settings = { gatewayUrl: normalizeTrialGatewayUrl(gatewayUrl) };
  await writeFile(path.join(generatedDirectory, 'trial-service.json'), `${JSON.stringify(settings)}\n`);
}

export async function verifyReleaseTrialService(directory) {
  const filename = path.join(directory, 'trial-service.json');
  let file;
  try { file = await lstat(filename); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Release trial service is missing. Rebuild production resources before signing this release.');
    throw error;
  }
  if (!file.isFile() || file.isSymbolicLink() || file.size > 1024) throw new Error('Release trial service must be a regular public configuration file.');
  // Never accept the isolated local-test exception in a release.
  return readTrialService(directory, { environment: {} });
}
