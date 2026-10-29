import { defineConfig } from 'vite';

// В разработке браузер ходит на один origin (Vite), а /api и /uploads проксируются на наш сервер.
const backend = 'http://127.0.0.1:3000';

export default defineConfig({
  server: {
    proxy: {
      // changeOrigin: false — сохраняем исходный Host (localhost:5173), чтобы он совпадал с Origin
      // страницы и проходил проверку CSRF на сервере (сервер сравнивает Origin с Host).
      '/api': { target: backend, changeOrigin: false },
      '/uploads': { target: backend, changeOrigin: false },
    },
  },
});
