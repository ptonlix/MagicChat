import path from "node:path"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const sharedRendererDependencies = [
  "@base-ui/react",
  "@dnd-kit/core",
  "@fontsource/jetbrains-mono",
  "class-variance-authority",
  "clsx",
  "date-fns",
  "harmonyos-sans-sc-webfont-splitted",
  "lucide-react",
  "next-themes",
  "pinyin-pro",
  "radix-ui",
  "react",
  "react-day-picker",
  "react-dom",
  "react-markdown",
  "react-router",
  "recharts",
  "remark-flexible-markers",
  "remark-gfm",
  "remark-supersub",
  "shiki",
  "sonner",
  "tailwind-merge",
]

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: {
    build: {
      rollupOptions: {
        external: ["electron"],
        output: { entryFileNames: "[name].cjs", format: "cjs" },
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: path.resolve(__dirname, "src/renderer"),
    publicDir: path.resolve(__dirname, "public"),
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, "src/renderer/index.html"),
          recovery: path.resolve(__dirname, "src/renderer/recovery.html"),
          "proxy-auth": path.resolve(__dirname, "src/renderer/proxy-auth.html"),
        },
      },
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src/renderer"),
        "@desktop": path.resolve(__dirname, "src"),
      },
      dedupe: sharedRendererDependencies,
    },
    server: {
      port: 20050,
      strictPort: true,
      fs: { allow: [__dirname] },
    },
  },
})
