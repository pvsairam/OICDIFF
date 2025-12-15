import { build } from 'esbuild';

async function buildApi() {
  console.log('Building API for Vercel...');
  
  // Build from the source in server folder
  await build({
    entryPoints: ['server/api-vercel.ts'],
    platform: 'node',
    target: 'node18',
    bundle: true,
    format: 'esm',
    outfile: 'api/index.js',
    external: [
      'pg-native',
    ],
    minify: false,
    sourcemap: false,
    logLevel: 'info',
  });
  
  console.log('API build complete!');
}

buildApi().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
