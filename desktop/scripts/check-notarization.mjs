import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const releases = path.join(root, 'output/desktop-builds.noindex/releases');
const arch = process.arch;
const cached = process.argv.slice(2).includes('--cached');
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

async function latestRequest() {
  const requests = [];
  for (const entry of await readdir(releases, { withFileTypes: true })) {
    if (!entry.isDirectory() || !versionPattern.test(entry.name)) continue;
    try {
      const filename = path.join(releases, entry.name, `notarization-request-${arch}.json`);
      let request;
      try { request = JSON.parse(await readFile(filename, 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        request = JSON.parse(await readFile(path.join(releases, entry.name, `release-in-progress-${arch}.json`), 'utf8'));
      }
      if (request.schemaVersion === 1 && request.version === entry.name && request.arch === arch
        && (uuid.test(request.submissionId || '') || Number.isFinite(Date.parse(request.startedAt)))
        && Number.isFinite(Date.parse(request.submittedAt || request.startedAt))) {
        requests.push(request);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return requests.sort((a, b) => Date.parse(b.submittedAt || b.startedAt) - Date.parse(a.submittedAt || a.startedAt))[0];
}

async function main() {
  let request = await latestRequest();
  if (!request) throw new Error('missing-request');
  const release = path.join(releases, request.version);
  const statusFile = path.join(release, `notarization-status-${arch}.json`);
  if (!request.submissionId) {
    if (!cached && process.env.APPLE_KEYCHAIN_PROFILE) {
      const args = ['notarytool', 'history', '--keychain-profile', process.env.APPLE_KEYCHAIN_PROFILE, '--output-format', 'json'];
      if (process.env.APPLE_KEYCHAIN) args.push('--keychain', process.env.APPLE_KEYCHAIN);
      const history = JSON.parse(execFileSync('/usr/bin/xcrun', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
      const submission = history.history?.filter(item => item.name === 'Lumior.zip' && uuid.test(item.id) && Date.parse(item.createdDate) >= Date.parse(request.startedAt))
        .sort((a, b) => Date.parse(b.createdDate) - Date.parse(a.createdDate))[0];
      if (submission) {
        request = { schemaVersion: 1, version: request.version, arch, submissionId: submission.id, submittedAt: submission.createdDate, buildLog: request.buildLog };
        await writeFile(path.join(release, `notarization-request-${arch}.json`), `${JSON.stringify(request, null, 2)}\n`);
      }
    }
    if (!request.submissionId) {
      let completed;
      try {
        completed = JSON.parse(await readFile(path.join(release, `release-completed-${arch}.json`), 'utf8'));
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (completed?.schemaVersion === 1 && completed.version === request.version && completed.arch === arch
        && completed.buildLog === request.buildLog && completed.signatureAndNotarizationVerified === true
        && Number.isFinite(Date.parse(completed.completedAt))) {
        console.log(`Lumior ${request.version} 修正版：签名、公证及安装包校验已完成。`);
        console.log('依据本机发布与公证票据校验记录；尚未保存这次 Apple 提交编号。');
        console.log(`安装包目录：${path.join(release, 'updates/mac', arch)}`);
        if (cached) console.log('当前为离线记录；直接双击此入口可查询 Apple 服务结果。');
      } else {
        console.log(`Lumior ${request.version} 修正版正在签名或提交，尚未取得新的公证编号。`);
        console.log('可以稍后再打开此入口；旧包的公证结果不代表这次修正版。');
      }
      console.log(`构建日志：${path.join(root, request.buildLog)}`);
      return;
    }
  }
  let result;
  if (cached) {
    result = JSON.parse(await readFile(statusFile, 'utf8'));
    if (result.submissionId !== request.submissionId) throw new Error('wrong-request');
  } else {
    const profile = process.env.APPLE_KEYCHAIN_PROFILE;
    if (!profile) throw new Error('missing-profile');
    console.log('正在查询 Apple 公证结果…');
    const args = ['notarytool', 'info', request.submissionId, '--keychain-profile', profile, '--output-format', 'json'];
    if (process.env.APPLE_KEYCHAIN) args.push('--keychain', process.env.APPLE_KEYCHAIN);
    const response = JSON.parse(execFileSync('/usr/bin/xcrun', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
    if (response.id !== request.submissionId || !['In Progress', 'Accepted', 'Invalid', 'Rejected'].includes(response.status)) {
      throw new Error('unexpected-response');
    }
    result = { schemaVersion: 1, version: request.version, arch, submissionId: request.submissionId,
      status: response.status, checkedAt: new Date().toISOString() };
    await writeFile(statusFile, `${JSON.stringify(result, null, 2)}\n`);
  }
  const statuses = { 'In Progress': '处理中', Accepted: '已通过', Invalid: '未通过', Rejected: '未通过' };
  console.log(`\nLumior ${request.version} · ${arch === 'arm64' ? 'Apple 芯片版' : 'Intel 版'}`);
  console.log(`Apple 公证：${statuses[result.status] || '未知状态'}`);
  const checkedAt = new Date(result.checkedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  console.log(`${cached ? '上次' : '本次'}查询时间：${checkedAt}（北京时间）`);

  const directory = path.join(release, 'updates/mac', arch);
  let packageVerified = false;
  try {
    const verification = JSON.parse(await readFile(path.join(directory, 'release-verification.json'), 'utf8'));
    packageVerified = verification.version === request.version && verification.platform === 'mac'
      && verification.arch === arch && verification.files?.length === 2
      && new Set(verification.files.map(file => file.name)).size === 2;
    if (packageVerified) {
      for (const file of verification.files) {
        if (file.name !== `Lumior-${request.version}-mac-${arch}.zip`
          && file.name !== `Lumior-${request.version}-mac-${arch}.dmg`) { packageVerified = false; continue; }
        const stat = await lstat(path.join(directory, file.name));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes) packageVerified = false;
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log(`构建脚本校验记录：${packageVerified ? '已完成' : '尚未完成'}`);
  if (packageVerified) console.log(`安装包目录：${directory}`);
  else if (result.status === 'Accepted') console.log('Apple 已通过；请继续查看后台打包日志，确认最终构建校验完成。');
  else if (result.status === 'In Progress') console.log('Apple 仍在处理，可以稍后再打开此入口查询。');
  else console.log('公证未通过，请保留产物和日志，返回 Codex 处理。');
  try {
    const readiness = JSON.parse(await readFile(path.join(release, `release-readiness-blockers-${arch}.json`), 'utf8'));
    if (readiness.readyForPublication === false && Array.isArray(readiness.blockers) && readiness.blockers.length) {
      console.log('发布检查：仍有待修复事项，公证通过不代表可以发布。');
      for (const blocker of readiness.blockers) {
        if (typeof blocker.message === 'string') console.log(`待修复：${blocker.message}`);
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log(`构建日志：${path.join(root, request.buildLog)}`);
  console.log('真实跨版本升级验收另行安排；此入口只查询状态。');
}

main().catch(() => {
  console.error('暂时无法查询公证状态。请检查网络和现有钥匙串配置，或返回 Codex 查看构建日志。');
  process.exitCode = 1;
});
