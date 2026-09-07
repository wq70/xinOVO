import fs from 'node:fs';
import path from 'node:path';
import {
    bodyHtmlChunks,
    loaderInitScript,
    loaderMountScript,
    phoneHtmlChunks,
    renderChunkScript,
} from './html-chunks.mjs';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function writeIfChanged(relativePath, content) {
    const target = path.join(root, relativePath);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current !== content) fs.writeFileSync(target, content, 'utf8');
}

const template = read('src/index.template.html');
const html = template.replace(
    /^[ \t]*<!-- @include (.+?) -->\r?\n/gm,
    (_, includePath) => read(path.join('src', includePath)),
);
writeIfChanged('index.html', html);

const generatedHtmlDirectory = path.join(root, 'js/generated/html');
fs.mkdirSync(generatedHtmlDirectory, { recursive: true });
const generatedHtmlFiles = new Set(['00-init.js', '99-mount.js']);
writeIfChanged('js/generated/html/00-init.js', loaderInitScript);
for (const [name, sources] of phoneHtmlChunks) {
    const output = `${name}.js`;
    generatedHtmlFiles.add(output);
    writeIfChanged(`js/generated/html/${output}`, renderChunkScript('phone', sources.map(source => read(path.join('src', source))).join('')));
}
for (const [name, sources] of bodyHtmlChunks) {
    const output = `${name}.js`;
    generatedHtmlFiles.add(output);
    writeIfChanged(`js/generated/html/${output}`, renderChunkScript('body', sources.map(source => read(path.join('src', source))).join('')));
}
writeIfChanged('js/generated/html/99-mount.js', loaderMountScript);
for (const file of fs.readdirSync(generatedHtmlDirectory)) {
    if (file.endsWith('.js') && !generatedHtmlFiles.has(file)) {
        fs.unlinkSync(path.join(generatedHtmlDirectory, file));
    }
}

const memoryParts = [
    'src/js/modules/memory-table/core.jsfrag',
    'src/js/modules/memory-table/rendering.jsfrag',
    'src/js/modules/memory-table/ai-update.jsfrag',
    'src/js/modules/memory-table/import-export.jsfrag',
    'src/js/modules/memory-table/events-and-api.jsfrag',
];
writeIfChanged('js/modules/memory_table.js', memoryParts.map(read).join(''));

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
    writeIfChanged(output, parts.map(read).join(''));
}

console.log('Built compact index.html, local HTML loaders, and legacy runtime bundles.');
