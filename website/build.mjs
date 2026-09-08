import { build, context } from 'esbuild';
import { mkdir, copyFile, cp } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await copyFile('index.html', 'dist/index.html');
await cp('public', 'dist', { recursive: true });
const options = { entryPoints: ['src/app.ts'], bundle: true, outdir: 'dist', format: 'esm', platform: 'browser', target: ['es2022'], minify: true, sourcemap: false };
if (process.argv.includes('--serve')) {
  const ctx = await context(options);
  await ctx.watch();
  const server = await ctx.serve({ servedir: 'dist', host: '127.0.0.1', port: 4173 });
  console.log(`Local website: http://${server.hosts[0]}:${server.port}`);
} else await build(options);
