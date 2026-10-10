import { brotliCompress, constants, gzip } from "node:zlib";
import { promisify } from "node:util";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const dist = path.resolve("dist");
const compressible = new Set([".html", ".css", ".js", ".svg", ".json", ".txt", ".xml", ".webmanifest", ".wasm"]);
let sources = 0;
let outputs = 0;
let saved = 0;

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await visit(file); continue; }
    if (!entry.isFile() || !compressible.has(path.extname(entry.name).toLowerCase())) continue;
    const original = await readFile(file);
    if (original.length < 512) continue;
    sources++;
    const variants = [
      ["br", await brotli(original, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } })],
      ["gz", await gzipAsync(original, { level: 8 })],
    ];
    for (const [extension, compressed] of variants) {
      if (compressed.length >= original.length - 32) continue;
      await writeFile(`${file}.${extension}`, compressed);
      outputs++;
      saved += original.length - compressed.length;
    }
  }
}

if (!(await stat(dist)).isDirectory()) throw new Error(`Build output not found: ${dist}`);
await visit(dist);
console.log(`Compressed ${outputs} assets from ${sources} source files; saved ${saved} bytes across Brotli and gzip variants.`);
