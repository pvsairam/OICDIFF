import { build } from 'esbuild';

async function buildApi() {
  console.log('Building API for Vercel...');
  
  await build({
    entryPoints: ['api/index.ts'],
    platform: 'node',
    target: 'node18',
    bundle: true,
    format: 'cjs',
    outfile: 'api/handler.js',
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
