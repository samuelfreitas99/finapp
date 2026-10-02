import { defineConfig } from 'tsup';

// Gera um único arquivo CommonJS com tudo embutido (inclusive os pacotes do
// workspace), para a imagem de produção não precisar de node_modules.
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  noExternal: [/.*/],
});
