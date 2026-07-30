import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'src/index.ts',
  format: 'esm',
  platform: 'node',
  target: 'node20.19',
  dts: true,
  fixedExtension: false,
  clean: true,
  treeshake: true,
});
