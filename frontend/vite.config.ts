import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendPort = process.env.CCR_PORT || "8080";
const vitePort = Number(process.env.CCR_VITE_PORT || "5173");

export default defineConfig({
  plugins: [react()],
  server: {
    port: vitePort,
    allowedHosts: [process.env.CCR_DOMAIN || "pri-u.net"],
    proxy: {
      "/api": {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
      "/ws": {
        target: `http://localhost:${backendPort}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: "../backend/static",
    emptyOutDir: true,
  },
});
