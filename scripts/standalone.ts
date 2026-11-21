import { readFile, writeFile } from 'node:fs/promises';

// Declare the native Bun API subset used by this script.
declare const HTMLRewriter: new () => {
  on(selector: string, handlers: {
    element(element: {
      getAttribute(name: string): string | null;
      replace(content: string, options: { html: true }): void;
    }): Promise<void>;
  }): { transform(response: Response): Response };
};

// Keep a double-clickable copy in the repository for players who do not use Node.
let html = await readFile('dist/index.html', 'utf8');
// Embed LF line endings so the output matches the committed artifact on any working-tree EOL.
const license = (await readFile('LICENSE', 'utf8')).replace(/\r\n?/g, '\n');
html = html.replace('<head>', () => `<head>\n<!--\n${license}-->`);
await writeFile('dist/index.html', html);
const cssPath = html.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/)?.[1];
if (!cssPath) throw new Error('Expected a single Vite CSS bundle');
const css = await readFile(`dist/${cssPath.replace(/^\.\//, '')}`, 'utf8');
const favicon = await readFile('favicon.svg', 'utf8');

let inlinedScript = false;
html = await new HTMLRewriter()
  .on('script[type="module"][src]', {
    async element(script) {
      const src = script.getAttribute('src');
      if (!src || inlinedScript) throw new Error('Expected a single Vite JS bundle');
      inlinedScript = true;
      const js = await readFile(`dist/${src.replace(/^\.\//, '')}`, 'utf8');
      script.replace(`<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`, { html: true });
    },
  })
  .transform(new Response(html))
  .text();
if (!inlinedScript) throw new Error('Expected a single Vite JS bundle');

html = html.replace(/<link[^>]+rel="stylesheet"[^>]+href="[^"]+"[^>]*>/, () => `<style>${css}</style>`);
html = html.replace(/(<link[^>]+rel="icon"[^>]+href=")[^"]+("[^>]*>)/, (_: string, a: string, b: string) => a + `data:image/svg+xml,${encodeURIComponent(favicon)}` + b);
await writeFile('play.html', html);
console.log('Created play.html — download and open in a browser to play.');
