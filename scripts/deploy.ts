import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function deploy(env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch) {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const zone = required('BUNNY_STORAGE_ZONE');
  const host = required('BUNNY_STORAGE_HOST');
  const storageKey = required('BUNNY_STORAGE_PASSWORD');
  if (!/^[a-zA-Z0-9-]+$/.test(zone)) throw new Error('Invalid storage zone name');
  if (!/^(?:[a-z]+\.)?storage\.bunnycdn\.com$/.test(host)) throw new Error('Expected a Bunny storage hostname without https:// or a path');

  const files: string[] = [];
  async function collect(directory: string) {
    for (const entry of await readdir(join('dist', directory), { withFileTypes: true })) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await collect(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Unsupported build entry: ${path}`);
    }
  }
  await collect('');
  if (!files.includes('index.html')) throw new Error('Build dist/index.html before deploying');
  // Publish the entry point last, so its hashed assets already exist.
  files.sort();
  files.splice(files.indexOf('index.html'), 1);
  files.push('index.html');
  const types: Record<string, string> = {
    html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8', svg: 'image/svg+xml',
  };
  for (const file of files) {
    const path = file.split('/').map(encodeURIComponent).join('/');
    const response = await request(`https://${host}/${zone}/${path}`, {
      method: 'PUT',
      headers: {
        AccessKey: storageKey,
        'Content-Type': types[file.split('.').pop()!] ?? 'application/octet-stream',
      },
      body: new Uint8Array(await readFile(join('dist', file))),
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
    // Do not print response bodies: provider errors can contain private details.
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Upload failed for ${file}: HTTP ${response.status}`);
    console.log(`Uploaded ${file}`);
  }
  console.log('Production files uploaded.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await deploy();
}
