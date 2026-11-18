// Builds the launcher and every tool in suite.json, then assembles one static site:
//   dist/index.html          launcher
//   dist/<tool.path>/        each tool (a single self-contained index.html)
import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const suite = JSON.parse(fs.readFileSync(path.join(root, 'suite.json'), 'utf8'));
const out = path.join(root, 'dist');
const run = (cmd, cwd) => execSync(cmd, {cwd, stdio: 'inherit'});

fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(out, {recursive: true});

console.log('\n== launcher');
run('npm run build', path.join(root, 'apps/launcher'));
fs.cpSync(path.join(root, 'apps/launcher/dist'), out, {recursive: true});

for (const tool of suite.tools) {
  console.log(`\n== ${tool.name}`);
  const app = path.join(root, tool.app);
  run('npm run build', app);
  const dest = path.join(out, tool.path);
  fs.mkdirSync(dest, {recursive: true});
  fs.copyFileSync(path.join(app, 'dist/index.html'), path.join(dest, 'index.html'));
}
console.log(`\nSuite built in ${path.relative(process.cwd(), out) || '.'}: launcher + ${suite.tools.map(t => '/' + t.path).join(', ')}`);
