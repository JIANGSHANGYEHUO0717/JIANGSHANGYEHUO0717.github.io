import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {createHash} from 'node:crypto';

const root=path.resolve(process.argv[2]);
const html=await fs.readFile(path.join(root,'直接打开预览.html'),'utf8');
assert.ok(html.includes('id="exhibition-root"'));
assert.ok(html.includes('<style>'));
// React contains a literal '<script' string inside the inline JavaScript;
// count real closing tags, not HTML-like text inside that script element.
assert.equal((html.match(/<\/script>/gi)||[]).length,1);
assert.equal(html.match(/<script\b[^>]*>/)?.[0],'<script>');
assert.ok(!/<link[^>]+href="(?!data:)/i.test(html));
const code=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(code?.length>100000);
new Script(code); // Parse the exact inline IIFE without executing browser code.
const manifest=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const lock=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8'));
assert.deepEqual(manifest.dependencies,lock.packages[''].dependencies);
for(const [name,version] of Object.entries(manifest.dependencies)) assert.equal(lock.packages['node_modules/'+name].version,version);
const production=await fs.readFile(path.join(root,'dist/exhibition/exhibition.html'),'utf8');
for(const match of production.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)) await fs.access(path.join(root,'dist/exhibition',match[1]));
async function files(dir) {
  const result=[];
  for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
    assert.ok(!['node_modules','.git','.env'].includes(entry.name));
    const file=path.join(dir,entry.name);
    if(entry.isDirectory())result.push(...await files(file));else result.push(file);
  }
  return result.sort();
}
const hashes={};
for(const file of await files(root)) {
  const relative=path.relative(root,file).replaceAll('\\','/');
  if(relative==='SHA256SUMS.json')continue;
  assert.ok(!/\.(mp4|mov|fbx|glb|gltf)$/i.test(relative));
  hashes[relative]=createHash('sha256').update(await fs.readFile(file)).digest('hex');
}
await fs.writeFile(path.join(root,'SHA256SUMS.json'),JSON.stringify(hashes,null,2)+'\n');
console.log(JSON.stringify({checks:'passed',inlineScriptBytes:code.length,files:Object.keys(hashes).length+1,externalHtmlAssets:0},null,2));
