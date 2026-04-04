import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { ViteMinifyPlugin } from 'vite-plugin-minify';
export default defineConfig({
    plugins: [
        viteSingleFile(),
        ViteMinifyPlugin({
            collapseWhitespace: true,
            removeComments: true,
            minifyCSS: true,
            minifyJS: true,
        }),
    ],
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
