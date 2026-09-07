import { createServer } from 'vite';
export default async function setup() {
  const server = await createServer({
    configFile: 'vite.gis-test.config.js',
    server: { strictPort: true },
  });
  await server.listen();
  return () => server.close();
}
