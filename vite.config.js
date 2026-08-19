import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "child_process";
import pkg from "./package.json";

const plugins = [react()];

function getVendorChunk(id) {
  if (!id.includes("node_modules")) return undefined;

  // Keep framework code stable across page edits. This does not change runtime behavior,
  // but it stops a small Ascendara change from invalidating every large dependency chunk.
  if (
    id.includes("/react/") ||
    id.includes("/react-dom/") ||
    id.includes("/react-router") ||
    id.includes("/scheduler/")
  ) {
    return "vendor-react";
  }

  // Firebase is one of the heaviest dependency families and changes independently from
  // the launcher UI, so isolating it improves cache reuse for users who update often.
  if (id.includes("/firebase/") || id.includes("/@firebase/")) {
    return "vendor-firebase";
  }

  if (id.includes("/framer-motion/")) {
    return "vendor-motion";
  }

  if (
    id.includes("/@radix-ui/") ||
    id.includes("/lucide-react/") ||
    id.includes("/sonner/") ||
    id.includes("/next-themes/")
  ) {
    return "vendor-ui";
  }

  if (id.includes("/recharts/") || id.includes("/d3-")) {
    return "vendor-charts";
  }

  return "vendor";
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: plugins,
  publicDir: path.join(__dirname, "src/public"),
  envDir: __dirname,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_REVISION__: JSON.stringify(execSync("git rev-parse HEAD").toString()),
  },
  root: path.join(__dirname, "src"),
  base: "./",
  server: {
    port: 5173,
    proxy: {
      "/api/igdb": {
        target: "https://api.igdb.com/v4",
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/igdb/, ""),
        configure: (proxy, _options) => {
          proxy.on("error", (err, _req, _res) => {
            console.log("proxy error", err);
          });
          proxy.on("proxyReq", (proxyReq, req, _res) => {
            console.log("Sending Request to the Target:", req.method, req.url);
          });
          proxy.on("proxyRes", (proxyRes, req, _res) => {
            console.log(
              "Received Response from the Target:",
              proxyRes.statusCode,
              req.url
            );
          });
        },
      },
      "/api/torbox": {
        target: "https://api.torbox.app/v1/api",
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/torbox/, ""),
        configure: (proxy, _options) => {
          proxy.on("error", (err, _req, _res) => {
            console.log("Torbox proxy error", err);
          });
          proxy.on("proxyReq", (proxyReq, req, _res) => {
            console.log("Sending Request to Torbox API:", req.method, req.url);
          });
          proxy.on("proxyRes", (proxyRes, req, _res) => {
            console.log(
              "Received Response from Torbox API:",
              proxyRes.statusCode,
              req.url
            );
          });
        },
      },
      "/api/khinsider": {
        target: "https://downloads.khinsider.com",
        changeOrigin: true,
        secure: false,
        rewrite: path => path.replace(/^\/api\/khinsider/, ""),
        configure: (proxy, _options) => {
          proxy.on("error", (err, _req, _res) => {
            console.log("Khinsider proxy error", err);
          });
          proxy.on("proxyReq", (proxyReq, req, _res) => {
            console.log("Khinsider: Sending Request to the Target:", req.method, req.url);
          });
          proxy.on("proxyRes", (proxyRes, req, _res) => {
            console.log(
              "Khinsider: Received Response from the Target:",
              proxyRes.statusCode,
              req.url
            );
          });
        },
      },
      "/api/giantbomb": {
        target: "https://www.giantbomb.com/api",
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/giantbomb/, ""),
        configure: (proxy, _options) => {
          proxy.on("error", (err, _req, _res) => {
            console.log("GiantBomb proxy error", err);
          });
          proxy.on("proxyReq", (proxyReq, req, _res) => {
            console.log("Sending GiantBomb Request:", req.method, req.url);
          });
          proxy.on("proxyRes", (proxyRes, req, _res) => {
            console.log("Received GiantBomb Response:", proxyRes.statusCode, req.url);
          });
        },
      },
      "/api/flingtrainer": {
        target: "https://flingtrainer.com",
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/flingtrainer/, ""),
        configure: (proxy, _options) => {
          proxy.on("error", (err, _req, _res) => {
            console.log("FlingTrainer proxy error", err);
          });
        },
      },
      "/api/steam/search": {
        target: "https://store.steampowered.com/api",
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/steam\/search/, "/storesearch"),
        configure: (proxy, _options) => {
          proxy.on("error", (err, _req, _res) => {
            console.log("Steam Store Search proxy error", err);
          });
        },
      },
      "/api/steam/applist": {
        target: "https://api.steampowered.com",
        changeOrigin: true,
        rewrite: path =>
          path.replace(/^\/api\/steam\/applist/, "/ISteamApps/GetAppList/v2"),
        configure: (proxy, _options) => {
          proxy.on("error", (err, _req, _res) => {
            console.log("Steam App List proxy error", err);
          });
        },
      },
      "/api/steam/appdetails": {
        target: "https://store.steampowered.com/api",
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/steam\/appdetails/, "/appdetails"),
        configure: (proxy, _options) => {
          proxy.on("error", (err, _req, _res) => {
            console.log("Steam App Details proxy error", err);
          });
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.join(__dirname, "src"),
    },
  },
  build: {
    copyPublicDir: true,
    outDir: path.join(__dirname, "build"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(__dirname, "src/index.html"),
      output: {
        manualChunks: getVendorChunk,
      },
    },
    assetsDir: "assets",
    sourcemap: true,
  },
});
