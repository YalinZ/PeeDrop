// Inspect the exact staged bytes, never print matching private values.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const files = git(['ls-files', '--stage', '-z']).toString('utf8').split('\0').filter(Boolean);
const privateValues = [];
const configPath = path.join(root, 'miniprogram/config.local.js');
if (fs.existsSync(configPath)) privateValues.push(...Object.values(require(configPath)));
const projectPath = path.join(root, 'project.config.json');
if (fs.existsSync(projectPath)) privateValues.push(JSON.parse(fs.readFileSync(projectPath, 'utf8')).appid);
const actualValues = privateValues.filter(value => typeof value === 'string' && value.length >= 8 && !value.includes('YOUR_'));
const blockedPath = /(^|\/)(node_modules|miniprogram_npm|asset-source|\.git|\.codex|\.agents)(\/|$)|(^|\/)project(?:\.private)?\.config\.json$|(^|\/)config\.local\.(js|json)$|(^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx|log|zip|sql|sqlite|db)$/i;
const patterns = [
  /\bwx[a-f0-9]{16}\b/i,
  /cloud:\/\/(?!YOUR_CLOUD_ENV_ID\.)[^\s'"`<>]+/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKID[A-Za-z0-9]{16,})\b/,
  /(?:resourceEnv|envId)\s*[:=]\s*['"](?!YOUR_)[\w-]{8,}['"]/i,
  /[A-Z]:[\\/](?:Users|Documents and Settings)[\\/][^\s'"`]+/i
];
let failed = false;
for (const entry of files) {
  const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(entry);
  if (!match) throw Error('Unexpected Git index entry');
  const [, mode, sha, stage, file] = match;
  if (stage !== '0' || mode === '120000' || blockedPath.test(file)) {
    console.error('Blocked path or unresolved entry: ' + file); failed = true; continue;
  }
  const bytes = git(['cat-file', 'blob', sha]);
  if (actualValues.some(value => bytes.includes(Buffer.from(value)))) {
    console.error('Private configuration value found: ' + file); failed = true;
  }
  if (/\.(?:png|jpe?g)$/i.test(file)) continue;
  const text = bytes.toString('utf8');
  if (patterns.some(pattern => pattern.test(text))) {
    console.error('Potential identifier or credential found: ' + file); failed = true;
  }
}
if (!files.length) throw Error('No staged files to inspect');
console.log((failed ? 'FAIL' : 'PASS') + ': inspected ' + files.length + ' staged files; private values are never printed.');
process.exitCode = failed ? 1 : 0;
