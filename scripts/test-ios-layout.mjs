import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const baseCss = read('css/base.css');
const layoutCss = read('css/layout.css');
const chatCss = read('css/chat.css');
const shellHtml = read('src/html/shell/root.html');
const indexTemplate = read('src/index.template.html');

assert.match(
    indexTemplate,
    /apple-mobile-web-app-status-bar-style" content="default"/,
    'Home Screen apps must use an opaque system-owned status bar.',
);
assert.match(layoutCss, /\.phone-screen\s*\{[\s\S]*?height:\s*100vh;[\s\S]*?height:\s*100dvh;/);
assert.doesNotMatch(
    layoutCss,
    /html\.is-ios-pwa\s+\.phone-screen\s*\{[\s\S]*?height:\s*100vh/,
    'iOS must not override the dynamic viewport with the layout viewport.',
);
assert.doesNotMatch(baseCss, /ovo-ios-pwa-top-guard|ios-pwa-status-bar-guard/);
assert.doesNotMatch(shellHtml, /ios-pwa-status-bar-guard/);
assert.match(layoutCss, /html\.is-ios\s+\.app-header\s*\{[\s\S]*?background-color:\s*var\(--ovo-header-bg\)/);
assert.match(chatCss, /#chat-room-screen\s+\.content\s*\{[\s\S]*?min-height:\s*0/);
assert.match(chatCss, /\.message-area\s*\{[\s\S]*?min-height:\s*0/);
assert.match(chatCss, /\.chat-input-wrapper\s*\{[\s\S]*?flex-shrink:\s*0;[\s\S]*?min-height:\s*0/);

console.log('iOS layout regression tests passed: dynamic viewport, native safe area, opaque header, and shrinkable chat stack.');
