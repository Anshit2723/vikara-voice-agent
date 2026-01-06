import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // The third parameter "" means load all env vars, not just VITE_*
  const env = loadEnv(mode, process.cwd(), "");

  return {
    server: {
      port: 3000,
      host: "0.0.0.0",
      proxy: {
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
      },
    },
    plugins: [react()],
    define: {
      // This is the critical fix. 
      // We take GEMINI_API_KEY from your .env file and expose it as process.env.API_KEY in the browser.
      "process.env.API_KEY": JSON.stringify(env.GEMINIAPIKEY),
    },
  };
});