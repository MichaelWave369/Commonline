import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { pilotViteServerConfigFromEnv } from "./pilotHostConfig";

export default defineConfig({
  plugins: [react()],
  server: pilotViteServerConfigFromEnv()
});
