import { createServer } from 'node:net';

/**
 * Find a free TCP port for Express in Electron prod mode.
 * Creates a temporary server, binds to port 0, reads the assigned port,
 * closes the server, and returns the port number.
 */
export default function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
