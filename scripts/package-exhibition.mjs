import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const destination=path.resolve(process.argv[2] || path.join(project,'../outputs',`point-cloud-terrain-${Date.now()}`));
try { await fs.access(destination); throw new Error('Refusing to overwrite an existing package directory'); }
catch(error) { if(error.code!=='ENOENT') throw error; }
await fs.mkdir(destination,{recursive:true});
const copy=async (source,target)=>fs.cp(path.join(project,source),path.join(destination,target),{recursive:true});
await copy('src/exhibition','src/exhibition');
await copy('tests/exhibition-terrain.test.mjs','tests/exhibition-terrain.test.mjs');
await copy('exhibition.html','exhibition.html');
await copy('exhibition.vite.config.mjs','exhibition.vite.config.mjs');
await copy('dist/exhibition','dist/exhibition');
await copy('qa/exhibition','qa/exhibition');
await copy('../outputs/terrain-concepts-20260830-round-mounds','references/concepts');
await copy('../outputs/点云地形与五模型旋转展示方案.md','references/早期方案-五模型未实施.md');

// Use the exact installed dependency versions and existing cross-platform lock.
const original=JSON.parse(await fs.readFile(path.join(project,'package.json'),'utf8'));
const lock=JSON.parse(await fs.readFile(path.join(project,'package-lock.json'),'utf8'));
const dependencies={};
for(const name of ['@vitejs/plugin-react','react','react-dom','three','vite','esbuild']) {
  dependencies[name]=JSON.parse(await fs.readFile(path.join(project,'node_modules',name,'package.json'),'utf8')).version;
}
const manifest={name:'approved-point-cloud-terrain',version:'1.0.0',private:true,type:'module',
  scripts:{dev:'vite --config exhibition.vite.config.mjs --port 5192',build:'vite build --config exhibition.vite.config.mjs',test:'node --test tests/exhibition-terrain.test.mjs',preview:'vite preview --config exhibition.vite.config.mjs --host 127.0.0.1 --port 5193','build:offline':'node scripts/build-offline.mjs'},
  engines:{node:'^20.19.0 || >=22.12.0'},dependencies};
lock.name=manifest.name; lock.version=manifest.version;
lock.packages['']={name:manifest.name,version:manifest.version,dependencies,engines:manifest.engines};
delete lock.packages['node_modules/@mediapipe/tasks-vision'];
await fs.writeFile(path.join(destination,'package.json'),JSON.stringify(manifest,null,2)+'\n');
await fs.writeFile(path.join(destination,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');

const offlineBuilder=`import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const result=await build({absWorkingDir:root,entryPoints:['src/exhibition/main.jsx'],bundle:true,write:false,format:'iife',platform:'browser',target:['es2020'],minify:true,legalComments:'inline',define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'empty'}});
const css=await fs.readFile(path.join(root,'src/exhibition/style.css'),'utf8');
const template=await fs.readFile(path.join(root,'exhibition.html'),'utf8');
const html=template.replace('</head>','<style>'+css+'</style></head>').replace(/<script type="module"[^>]*><\\/script>/,()=>'<script>'+result.outputFiles[0].text.replace(/<\\/script/gi,'<\\\\/script')+'</script>');
await fs.writeFile(path.join(root,'直接打开预览.html'),html);
console.log('Offline HTML rebuilt');
`;
await fs.mkdir(path.join(destination,'scripts'),{recursive:true});
await fs.writeFile(path.join(destination,'scripts/build-offline.mjs'),offlineBuilder);
// Compile identical source without network-loaded modules or external assets.
const result=await build({absWorkingDir:project,entryPoints:['src/exhibition/main.jsx'],bundle:true,write:false,format:'iife',platform:'browser',target:['es2020'],minify:true,legalComments:'inline',define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'empty'}});
const css=await fs.readFile(path.join(project,'src/exhibition/style.css'),'utf8');
const template=await fs.readFile(path.join(project,'exhibition.html'),'utf8');
const html=template.replace('</head>','<style>'+css+'</style></head>').replace(/<script type="module"[^>]*><\/script>/,()=>'<script>'+result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')+'</script>');
await fs.writeFile(path.join(destination,'直接打开预览.html'),html);
await fs.mkdir(path.join(destination,'licenses'),{recursive:true});
for(const name of Object.keys(dependencies).concat('scheduler')) {
  for(const filename of ['LICENSE','LICENSE.md','LICENSE.txt']) {
    try {await fs.copyFile(path.join(project,'node_modules',name,filename),path.join(destination,'licenses',name.replaceAll('/','-')+'-LICENSE.txt'));break;}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
}
await fs.writeFile(path.join(destination,'README-请先阅读.md'),`# 点云地形 · 已确认版本

交付日期：2026-08-30。包括用户确认的圆钝、疏朗点云地形和戏剧光照。

## 直接查看

1. 将整个 ZIP 解压到普通文件夹，不要直接在压缩软件内打开。
2. 用桌面版 Chrome 或 Edge 打开根目录的“直接打开预览.html”。
3. 无需联网、安装 Node.js 或启动服务器；浏览器须支持 WebGL 2，并允许硬件加速。
4. 默认戏剧光照、顺时针慢转；右下角可切换原光照、暂停旋转或返回参考视角。

这是实时三维点云，不是截图或视频。单文件版由同一份源码打包，交互与正式构建一致。

## 文件内容

- 直接打开预览.html：包含所需脚本和样式的单文件成品。
- src/exhibition/：完整地形、光照、渲染、界面源码及设计记录。
- exhibition.html、exhibition.vite.config.mjs：开发入口和独立构建配置。
- package.json、package-lock.json：固定版本的依赖声明和安装锁文件。
- dist/exhibition/：生产构建的网页及本地静态资源。
- tests/：八项回归测试。
- scripts/build-offline.mjs：从源码重新生成单文件预览。
- qa/exhibition/：当前/历史截图、对照工具和验证记录；当前版本以 lighting-qa.md 为准。
- references/concepts/：三张生成候选图和生成说明，其中第 2 张被选中；不参与运行时渲染。
- references/早期方案-五模型未实施.md：早期方案留档；五个模型不在本次版本中。
- licenses/：使用的主要第三方库许可，分发时请保留。
- SHA256SUMS.json：包内文件校验清单。

不包含原视频、五个模型、其他项目、node_modules、开发缓存或系统环境文件。源码依赖可依据锁文件重新安装；单文件预览和 dist 成品已包含必要运行代码。

## 继续开发

安装符合 package.json engines 的 Node.js 后，在解压目录执行：

\x60\x60\x60text
npm ci
npm run dev
npm test
npm run build
npm run build:offline
\x60\x60\x60

开发页：http://127.0.0.1:5192/exhibition.html 。静态成品可用 npm run preview 在 5193 端口查看。部署时以 dist/exhibition 为网站根目录，入口为 exhibition.html；本次没有公网部署。修改源码后必须重新构建，旧单文件不会自动更新。

## 当前范围与注意点

- 仅桌面端、纯点地形，无模型、线条、辉光、视频或图片背景。
- 111,636 个点；180 秒一圈；减少动态效果偏好会令页面默认暂停。
- 两种光照共用同一组几何。戏剧光照预计算于地形局部坐标，随地形整体转动，不是世界空间固定灯光。
- 中央原有浅起伏没有加高，只通过光照增强层次。颜色、阴影强度可在 lighting.js / terrain.js 中继续微调。
- 历史说明中的工作区绝对路径仅用于溯源；包内实际参考图位于 references/concepts。历史效果不代表当前默认。
- 自动化测试、生产构建通过；实际流畅度仍取决于桌面显卡和浏览器设置。
- 验证限制：当前工具的浏览器安全策略禁止访问 file://，因此没有在此环境完成单文件版的双击实测。已检查其内嵌脚本语法、样式和资源完整性；此前同源网页版本的显示与光照切换已在浏览器验证。
`);

async function listFiles(dir) {
  const result=[];
  for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
    const file=path.join(dir,entry.name);
    if(entry.isDirectory())result.push(...await listFiles(file));else result.push(file);
  }
  return result.sort();
}
const sums={};
for(const file of await listFiles(destination)) sums[path.relative(destination,file).replaceAll('\\','/')]=createHash('sha256').update(await fs.readFile(file)).digest('hex');
await fs.writeFile(path.join(destination,'SHA256SUMS.json'),JSON.stringify(sums,null,2)+'\n');
console.log(JSON.stringify({destination,files:Object.keys(sums).length+1,dependencies,offlineBytes:Buffer.byteLength(html)},null,2));
