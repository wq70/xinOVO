import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'parse5';

const root = path.resolve(import.meta.dirname, '..');
const failures = [];

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function fail(message) {
    failures.push(message);
}

function collectFiles(directory, extension = '.js') {
    const result = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) result.push(...collectFiles(target, extension));
        else if (entry.name.endsWith(extension)) result.push(target);
    }
    return result;
}

const template = read('src/index.template.html');
const expectedHtml = template.replace(
    /^[ \t]*<!-- @include (.+?) -->\r?\n/gm,
    (_, includePath) => read(path.join('src', includePath)),
);
const html = read('index.html');
if (html !== expectedHtml) fail('index.html is stale; run npm run build');

const parseErrors = [];
const document = parse(html, {
    sourceCodeLocationInfo: true,
    onParseError: error => parseErrors.push(error),
});
// The legacy page contains one known literal "<" in text. It is retained to
// avoid altering user-visible content during the structural split.
const seriousParseErrors = parseErrors.filter(error => ![
    'missing-doctype',
    'non-void-html-element-start-tag-with-trailing-solidus',
    'invalid-first-character-of-tag-name',
].includes(error.code));
if (seriousParseErrors.length) {
    fail(`HTML parser reported ${seriousParseErrors.length} error(s): ${seriousParseErrors.slice(0, 5).map(e => e.code).join(', ')}`);
}
const retainedLegacyTagErrors = parseErrors.filter(error => error.code === 'invalid-first-character-of-tag-name');
if (retainedLegacyTagErrors.length > 1) {
    fail(`Expected at most one retained legacy text parsing issue, found ${retainedLegacyTagErrors.length}`);
}

const ids = [];
const scripts = [];
const styles = [];
function walk(node) {
    if (node.attrs) {
        const id = node.attrs.find(attr => attr.name === 'id')?.value;
        if (id) ids.push(id);
        if (node.tagName === 'script') {
            const src = node.attrs.find(attr => attr.name === 'src')?.value;
            if (src) scripts.push(src);
        }
        if (node.tagName === 'link') {
            const rel = node.attrs.find(attr => attr.name === 'rel')?.value;
            const href = node.attrs.find(attr => attr.name === 'href')?.value;
            if (rel === 'stylesheet' && href) styles.push(href);
        }
    }
    for (const child of node.childNodes || []) walk(child);
}
walk(document);

const textualIds = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
const duplicateIds = [...new Set(textualIds.filter((id, index) => textualIds.indexOf(id) !== index))];
if (textualIds.length !== 2075) fail(`Expected 2075 textual IDs, found ${textualIds.length}`);
if (duplicateIds.length) fail(`Duplicate IDs: ${duplicateIds.join(', ')}`);

const requiredIds = [
    'home-screen', 'chat-list-screen', 'contacts-screen', 'chat-room-screen',
    'api-settings-screen', 'chat-settings-screen', 'group-settings-screen',
    'memory-table-screen', 'forum-screen', 'peek-screen', 'node-system-screen',
    'storage-screen',
];
for (const id of requiredIds) {
    if (!ids.includes(id)) fail(`Required UI element is missing: #${id}`);
}

for (const resource of [...scripts, ...styles]) {
    if (/^(?:https?:)?\/\//.test(resource)) continue;
    const clean = resource.split(/[?#]/, 1)[0];
    if (!fs.existsSync(path.join(root, clean))) fail(`Missing local resource: ${resource}`);
}

const forbiddenAuthMarkers = [
    'ephone_auth', 'puppy-subscription-api', 'renderLoginOverlay',
    'tryLogin', 'login-overlay',
];
const searchableFiles = [path.join(root, 'index.html'), ...collectFiles(path.join(root, 'js'))];
for (const marker of forbiddenAuthMarkers) {
    if (searchableFiles.some(file => fs.readFileSync(file, 'utf8').includes(marker))) {
        fail(`Removed authentication marker still exists: ${marker}`);
    }
}

for (const file of collectFiles(path.join(root, 'js'))) {
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (check.status !== 0) fail(`JavaScript syntax error in ${path.relative(root, file)}: ${check.stderr.trim()}`);
}

const memoryParts = [
    'src/js/modules/memory-table/core.jsfrag',
    'src/js/modules/memory-table/rendering.jsfrag',
    'src/js/modules/memory-table/ai-update.jsfrag',
    'src/js/modules/memory-table/import-export.jsfrag',
    'src/js/modules/memory-table/events-and-api.jsfrag',
];
if (memoryParts.map(read).join('') !== read('js/modules/memory_table.js')) {
    fail('Generated memory_table.js does not match its source fragments');
}

const generatedBundles = [
    ['js/settings/chat-settings.js', [
        'src/js/settings/chat-settings/setup.jsfrag',
        'src/js/settings/chat-settings/theater-helpers.jsfrag',
        'src/js/settings/chat-settings/load.jsfrag',
        'src/js/settings/chat-settings/save.jsfrag',
    ]],
    ['js/modules/avatar_recognition.js', [
        'src/js/modules/avatar-recognition/part-01.jsfrag',
        'src/js/modules/avatar-recognition/part-02.jsfrag',
        'src/js/modules/avatar-recognition/part-03.jsfrag',
    ]],
    ['js/modules/video_call.js', [
        'src/js/modules/video-call/part-01.jsfrag',
        'src/js/modules/video-call/part-02.jsfrag',
        'src/js/modules/video-call/part-03.jsfrag',
    ]],
];
for (const [output, parts] of generatedBundles) {
    if (parts.map(read).join('') !== read(output)) {
        fail(`Generated ${output} does not match its source fragments`);
    }
}

if (failures.length) {
    console.error('\nVerification failed:');
    for (const message of failures) console.error(`- ${message}`);
    process.exit(1);
}

console.log(`Verification passed: ${textualIds.length} unique IDs, ${scripts.length} scripts, ${styles.length} stylesheets.`);
