import { mergeConfig } from 'vite';
import config from './vite.config.js';
export default mergeConfig(config, {
  server: { open: false, host: '127.0.0.1', port: 5178 },
});
