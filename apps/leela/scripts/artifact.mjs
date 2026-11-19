// Writes dist/artifact.html: the built page reshaped for the claude.ai Artifact
// publisher, which supplies its own doctype/html/head/body skeleton.
import fs from 'node:fs';
const html = fs.readFileSync('dist/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/i)[1]
  .replace(/<meta charset[^>]*>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/i)[1];
const title = head.match(/<title>[\s\S]*?<\/title>/i)[0];
// Bundled libraries carry a literal U+FFFD inside JS strings; the publisher rejects
// that character, so write it as the equivalent JS escape sequence.
const out = (title + head.replace(title, '') + body).replace(/�/g, '\\uFFFD');
fs.writeFileSync('dist/artifact.html', out);
console.log('wrote dist/artifact.html');
