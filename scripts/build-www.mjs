// Copia los archivos de la web a www/, que es lo que se empaqueta en la app Android.
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const FILES = ['index.html', 'main.js', 'style.css', 'favicon.png', 'challenge.html', 'challenge.js'];

rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const file of FILES) cpSync(file, `www/${file}`);
console.log(`www/ listo (${FILES.length} archivos)`);
