import { mergeConfig } from 'vite';
import config from './vite.config.js';
import { createDeterministicAguiPlugin } from './tests/gis/agui/deterministicService.js';
export default mergeConfig(config, {
  plugins: [createDeterministicAguiPlugin()],
  server: { open: false, host: '127.0.0.1', port: 5178 },
});
