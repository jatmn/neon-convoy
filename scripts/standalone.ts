import { readFile, writeFile } from 'node:fs/promises';
// Keep a double-clickable copy in the repository for players who do not use Node.
let html = await readFile('dist/index.html', 'utf8');
const jsPath = html.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/)?.[1];
const cssPath = html.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/)?.[1];
if (!jsPath || !cssPath) throw new Error('Expected a single Vite JS and CSS bundle');
const js = await readFile(`dist/${jsPath.replace(/^\.\//, '')}`, 'utf8');
const css = await readFile(`dist/${cssPath.replace(/^\.\//, '')}`, 'utf8');
const favicon = await readFile('favicon.svg', 'utf8');
html = html.replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/, () => `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`);
html = html.replace(/<link[^>]+rel="stylesheet"[^>]+href="[^"]+"[^>]*>/, () => `<style>${css}</style>`);
html = html.replace(/(<link[^>]+rel="icon"[^>]+href=")[^"]+("[^>]*>)/, (_: string, a: string, b: string) => a + `data:image/svg+xml,${encodeURIComponent(favicon)}` + b);
await writeFile('play.html', html);
console.log('Created play.html — download and open in a browser to play.');
