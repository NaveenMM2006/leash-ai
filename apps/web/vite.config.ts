import net from 'node:net';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const API_TARGET = process.env.LEASH_API_URL ?? 'http://127.0.0.1:4000';

/**
 * During dev startup, Vite boots faster than the Node/Prisma backend.
 * This middleware intercepts /api requests and briefly waits for the backend port
 * to open (up to 5s) before proxying, eliminating startup ECONNREFUSED blips.
 */
function waitForBackendPlugin(targetUrl: string): Plugin {
  let isReady = false;

  const isPortOpen = (host: string, port: number): Promise<boolean> =>
    new Promise((resolve) => {
      const socket = net.connect({ host, port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
    });

  return {
    name: 'wait-for-backend',
    configureServer(server) {
      server.middlewares.use(async (req, _res, next) => {
        if (isReady || !req.url?.startsWith('/api')) {
          return next();
        }
        try {
          const url = new URL(targetUrl);
          const host = url.hostname;
          const port = Number(url.port) || 4000;
          const maxWaitMs = 6000;
          const start = Date.now();
          while (Date.now() - start < maxWaitMs) {
            if (await isPortOpen(host, port)) {
              isReady = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 100));
          }
        } catch {
          // If URL parsing fails, proceed directly to proxy
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), waitForBackendPlugin(API_TARGET)],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // The dashboard talks to the API through this proxy, so browser requests
    // are same-origin and the server needs no CORS allowances.
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if ('writeHead' in res && 'headersSent' in res && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: {
                    code: 'BAD_GATEWAY',
                    message: 'Backend server is starting up, retrying...',
                  },
                }),
              );
            }
          });
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
