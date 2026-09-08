import { mergeConfig } from 'vite';
import config from './vite.config.js';

export default mergeConfig(config, {
  server: {
    open: false,
    host: '127.0.0.1',
    port: 5179,
    proxy: {
      '/__gis-harness': {
        target: 'http://127.0.0.1:3190',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('origin', 'http://127.0.0.1:3190');
          });
        },
      },
    },
  },
});
