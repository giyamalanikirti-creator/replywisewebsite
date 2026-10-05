import { rm, cp, mkdir } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
console.info('Built static frontend in dist; Vercel serves api/ as server-side functions.');
