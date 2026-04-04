import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { ViteMinifyPlugin } from 'vite-plugin-minify';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    plugins: [
        viteSingleFile(),
        ViteMinifyPlugin({
            collapseWhitespace: true,
            removeComments: true,
            minifyCSS: true,
            minifyJS: true,
        }),
        VitePWA({
            registerType: 'autoUpdate',
            manifest: {
                name: 'Cicada Whiteboard',
                short_name: 'Cicada',
                icons: [
                    {
                        src: 'assets/web-app-manifest-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                        "purpose": "maskable"
                    },
                    {
                        src: 'assets/web-app-manifest-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        "purpose": "maskable"
                    }
                ],
                "theme_color": "#f2f2f7",
                "background_color": "#f2f2f7",
                "display": "standalone"
            }
        })
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
