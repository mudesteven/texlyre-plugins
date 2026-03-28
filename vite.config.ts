import path from "node:path";
import { readFileSync } from "node:fs";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import wasm from "vite-plugin-wasm";
import { syncServerPlugin } from "./plugins/sync-server";

// Load .env manually so plugins can read process.env before Vite processes it
try {
  const env = readFileSync(path.resolve(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
} catch { /* no .env file */ }

const useHttps = process.env.VITE_USE_HTTPS === "true";

const basePath = "/texlyre/";

// @ts-ignore
export default defineConfig({
	base: basePath,

	define: {
		"process.env.npm_package_version": JSON.stringify(
			process.env.npm_package_version || "1.0.0",
		),
		__BASE_PATH__: JSON.stringify(basePath.slice(0, -1)),
	},

	build: {
		target: "esnext",
		commonjsOptions: {
			esmExternals: true,
		},
		rollupOptions: {
			input: {
				main: path.resolve(__dirname, 'index.html')
			},
			output: {
				manualChunks: {
					vendor: ["react", "react-dom"],
					pdfjs: ["pdfjs-dist"],
					codemirror: ["@codemirror/state", "@codemirror/view"],
					yjs: ["yjs", "y-indexeddb", "y-webrtc"],
					typst: ["@myriaddreamin/typst.ts"],
				},
			},
		},
	},

	plugins: [
		syncServerPlugin(),
		wasm(),
		react(),
		...(useHttps ? [basicSsl()] : []),
		viteStaticCopy({
			targets: [
				{
					src: "node_modules/pdfjs-dist/cmaps/*",
					dest: "assets/cmaps/",
				},
				{
					src: "node_modules/mathlive/fonts/*",
					dest: "assets/fonts/",
				},
				{
					src: "node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/*",
					dest: "core/typst-ts-web-compiler/pkg/",
				},
				{
					src: "node_modules/@myriaddreamin/typst-ts-renderer/pkg/*",
					dest: "core/typst-ts-renderer/pkg/",
				},
				{
					src: "node_modules/detypify-service/train/model.onnx",
					dest: "core/detypify/",
				},
				{
					src: "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
					dest: "core/detypify/",
				},
				{
					src: "userdata.json",
					dest: "",
				},
				{
					src: "userdata.mobile.json",
					dest: "",
				},
				{
					src: "userdata.local.json",
					dest: "",
				},
				{
					src: "userdata.local.mobile.json",
					dest: "",
				},
			],
		}),
	],

	server: {
		host: true,
		https: useHttps,
		hmr: {
			port: 5173,
			clientPort: 5173,
		},
	},

	worker: {
		format: "es",
		plugins: () => [wasm()],
	},

	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
			'@src': path.resolve(__dirname, './src'),
			'@tests': path.resolve(__dirname, './tests'),
			"@codemirror/state": path.resolve("./node_modules/@codemirror/state"),
			"@codemirror/view": path.resolve("./node_modules/@codemirror/view"),
			yjs: path.resolve("./node_modules/yjs"),
			"y-codemirror.next": path.resolve("./node_modules/y-codemirror.next"),
		},
		dedupe: [
			"@codemirror/state",
			"@codemirror/view",
			"yjs",
			"y-codemirror.next",
		],
	},
	optimizeDeps: {
		include: [
			"@codemirror/state",
			"@codemirror/view",
			"@codemirror/lang-javascript",
			"codemirror",
			"yjs",
			"y-codemirror.next",
			"pdfjs-dist",
		],
		exclude: [
			"@myriaddreamin/typst.ts",
			"@typstyle/typstyle-wasm-bundler",
			"onnxruntime-web",
			"@excalidraw/excalidraw",
		],
	},
});