const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const appRoot = path.resolve(root, config.miniprogramRoot || '.');
// 来自本机微信开发者工具IMAGE_AND_AUDIO_LIMIT规则，检查的是资源总量。
const extensions = new Set(['.jpg', '.jpeg', '.png', '.svg', '.webp', '.gif',
  '.flac', '.m4a', '.ogg', '.ape', '.amr', '.wma', '.wav', '.mp3', '.mp4', '.aac', '.aiff', '.caf']);
const rules = config.packOptions?.ignore || [];
const unsupported = rules.filter(rule => !['file', 'folder', 'suffix', 'prefix'].includes(rule.type));
if (unsupported.length) throw Error('Unsupported packOptions.ignore rule; inspect the DevTools package report.');
if (config.packOptions?.include?.length) throw Error('Explicit include rules require checking the actual DevTools package.');
const ignored = relative => rules.some(rule => {
  const value = rule.value.replace(/\\/g, '/').replace(/^\//, '');
  if (rule.type === 'file') return relative === value;
  if (rule.type === 'folder') return relative.startsWith(value.replace(/\/$/, '') + '/');
  if (rule.type === 'suffix') return relative.endsWith(value);
  return relative.startsWith(value);
});
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const filename = path.join(dir, entry.name);
  const relative = path.relative(appRoot, filename).replace(/\\/g, '/');
  if (ignored(relative)) return [];
  return entry.isDirectory() ? walk(filename) : [filename];
});
const files = walk(appRoot).filter(file => extensions.has(path.extname(file).toLowerCase()))
  .map(file => ({ file: path.relative(appRoot, file), bytes: fs.statSync(file).size }));
const total = files.reduce((sum, file) => sum + file.bytes, 0);
console.table(files);
console.log(`Media total: ${total} bytes (${(total / 1024).toFixed(2)} KiB)`);
console.log(`Threshold: strictly below ${200 * 1024} bytes (200 KiB)`);
console.log(total < 200 * 1024 ? 'PASS' : 'FAIL: total media size exceeds budget');
console.log('Source estimate; final result is determined by the actual DevTools compiled package.');
process.exitCode = total < 200 * 1024 ? 0 : 1;
