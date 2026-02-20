import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { openAICompatibleProxyPlugin } from './server/openaiCompatibleProxyPlugin.js';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [tailwindcss(), react(), openAICompatibleProxyPlugin(env)],
      define: {
        'import.meta.env.OPENAI_COMPATIBLE_MODEL': JSON.stringify(
          env.OPENAI_COMPATIBLE_MODEL || ''
        ),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
