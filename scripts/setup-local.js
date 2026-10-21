const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const [source, target] of [
  ['project.config.example.json', 'project.config.json'],
  ['miniprogram/config.example.js', 'miniprogram/config.local.js']
]) {
  const destination = path.join(root, target);
  if (fs.existsSync(destination)) {
    console.log('Keep existing: ' + target);
    continue;
  }
  fs.copyFileSync(path.join(root, source), destination, fs.constants.COPYFILE_EXCL);
  console.log('Created: ' + target);
}
