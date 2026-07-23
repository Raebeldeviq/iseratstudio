import vinext from "vinext";
import { defineConfig } from "vite";

// Der Mac-Einzelplatzbetrieb benötigt weder Cloudflare-Bindings noch eine
// Hosting-Konfiguration. Dadurch startet und baut das Studio vollständig lokal.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 43181,
    strictPort: true,
    ...(isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : {}),
  },
  plugins: [vinext()],
});
