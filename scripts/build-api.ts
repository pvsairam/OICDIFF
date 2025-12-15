import { build } from 'esbuild';

async function buildApi() {
  console.log('Building API for Vercel...');
  
  // Build from the source in server folder
  // Use .mjs extension and add createRequire banner for ESM compatibility
  await build({
    entryPoints: ['server/api-vercel.ts'],
    platform: 'node',
    target: 'node20',
    bundle: true,
    format: 'esm',
    outfile: 'api/index.mjs',
    external: [
      'pg-native',
    ],
    banner: {
      js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
    },
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
