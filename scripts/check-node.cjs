// Stops early, with a readable message, when an old Node/npm runs this repo's scripts.
// (npm 6 does not know `-w`, so `npm run dev -w …` would re-run the root script forever.)
// Kept to syntax that even very old Node versions can parse.
var major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 22) {
  console.error('\nThis repo needs Node 22 or newer, but this shell is running Node ' + process.versions.node + '\nfrom ' + process.execPath + '.');
  if (/Pulsar/i.test(process.execPath)) console.error("That is the copy bundled with the Pulsar editor, which comes before your real Node on PATH.");
  console.error('Run `node -v` to check; open a fresh terminal or put your Node install ahead of it on PATH.\n');
  process.exit(1);
}
