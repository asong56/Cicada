import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
    plugins: [viteSingleFile()],
    build: {
        target: "esnext",
        assetsInlineLimit: 100000000,
        minify: "terser", 
        terserOptions: {
            compress: {
                drop_console: true,
            },
        },
    },
});
