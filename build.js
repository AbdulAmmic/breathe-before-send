'use strict';

// Bundles the renderer. The API key is not bundled; main.js reads it at runtime.

const path = require('path');
const esbuild = require('esbuild');

esbuild.buildSync({
    entryPoints: [path.join(__dirname, 'src', 'renderer.js')],
    bundle: true,
    outfile: path.join(__dirname, 'dist', 'renderer.bundle.js'),
    platform: 'browser',
    format: 'iife',
    logLevel: 'warning',
});
