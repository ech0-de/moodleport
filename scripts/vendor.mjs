// Copies the browser builds of the dependencies (and their licenses) from
// node_modules into public/vendor/, where backup.js loads them from.
import { cpSync, rmSync } from 'node:fs';

const files = {
    'jszip': ['dist/jszip.min.js', 'LICENSE.markdown'],
};

const target = new URL('../public/vendor/', import.meta.url);
rmSync(target, { recursive: true, force: true });

for (const [pkg, paths] of Object.entries(files)) {
    for (const path of paths) {
        const from = new URL(`../node_modules/${pkg}/${path}`, import.meta.url);
        const to = new URL(`${pkg}/${path.split('/').pop()}`, target);
        cpSync(from, to);
    }
}
