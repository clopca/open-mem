import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss(), react()],
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
	server: {
		proxy: {
			"/api": "http://localhost:3420",
		},
	},
});
