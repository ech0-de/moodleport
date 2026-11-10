(async () => {
    const chill = () => new Promise(resolve => setTimeout(resolve, Math.round(Math.random() * 1500))); 
    const icon = {
        'modtype_forum': '💬',
        'modtype_page': '📄',
        'modtype_feedback': '📣',
        'modtype_assign': '📤',
        'modtype_organizer': '📅',
        'modtype_resource': '📝',
        'modtype_choicegroup': '👥',
        'modtype_ratingallocate': '⚖️',
        'modtype_folder': '📂',
        'modtype_zoom': '☎️',
        'modtype_url': '🌍',
        'modtype_lti': '⛓️',
        'modtype_quiz': '✅'
    };
    const externalScripts = [
        'https://unpkg.com/file-saver/dist/FileSaver.min.js',
        'https://unpkg.com/jszip/dist/jszip.min.js'
    ];

    window.define = null;
    window.require = null;
    const scriptsReady = Promise.all(externalScripts.map((script) => new Promise((resolve) => {
        const st = document.createElement('script');
        st.src = script;
        st.addEventListener('load', resolve);
        document.body.appendChild(st);
    })));

    let html = '';
    const unsupported = new Map();

    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    // strips the page's own scripts and styles; any script that slips through
    // (e.g. inline event handlers) is blocked by the CSP in index.html
    const cleanHtml = (fragment) => {
        const tpl = document.createElement('template');
        tpl.innerHTML = fragment;
        tpl.content.querySelectorAll('script, style, noscript, template').forEach((e) => e.remove());
        return tpl.innerHTML;
    };

    const loader = document.createElement('div');
    loader.style.textAlign = 'center';
    loader.style.position = 'fixed';
    loader.style.bottom = '0px';
    loader.style.right = '0px';
    loader.style.left = '0px';
    loader.style.top = '0px';
    loader.style.display = 'flex';
    loader.style.alignItems = 'center';
    loader.style.justifyContent = 'center';
    loader.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    loader.style.zIndex = 99999;

    const content = document.createElement('div');
    content.style.backgroundColor = 'white';
    content.style.borderRadius = '5px';
    content.style.paddingInline = '1em';
    content.style.paddingBlock = '.5em';
    content.style.display = 'block';
    content.style.maxWidth = '300px';
    content.style.maxHeight = '200px';
    content.innerHTML = `<h2>Exporting...</h2>`;

    const progress = document.createElement('progress');
    content.appendChild(progress);
    
    const progressText = document.createElement('div');
    content.appendChild(progressText);
    
    const timeRemaining = document.createElement('small');
    content.appendChild(timeRemaining);

    loader.appendChild(content);

    const updateProgress = (i, t) => {
        progress.max = t;
        progress.value = i;
        progress.innerText = `${i} / ${t}`;
        progressText.innerText = `${i} / ${t}`;
        timeRemaining.innerText = `~${new Date((t - i) * 1000).toISOString().slice(11, 19)} remaining`;
    };

    document.body.appendChild(loader);

    await scriptsReady;

    const zip = new JSZip();
    const parser = new DOMParser();

    const course = document.querySelector('.page-header-headings h1')?.innerText || '';
    if (course) {
        html += `<h1>${escapeHtml(course)}</h1>\n`;
    }

    let current = 0;
    const total = document.querySelectorAll('.course-section').length + document.querySelectorAll('.activity').length;
    updateProgress(current, total);

    for (const section of document.querySelectorAll('.course-section')) {
        const title = section.querySelector('.sectionname')?.innerText || '';
        if (title) {
            html += `<h2>${escapeHtml(title)}</h2>\n`;
        }

        for (const activity of section.querySelectorAll('.activity')) {
            try {
                const type = [...activity.classList].find(e => String(e).startsWith('modtype_'));
                let contentHtml = null;
                let href = null;

                switch (type) {
                    case 'modtype_label':
                        contentHtml = activity.innerHTML;
                        break;

                    case 'modtype_url':
                    case 'modtype_zoom':
                    case 'modtype_quiz':
                    case 'modtype_forum':
                    case 'modtype_feedback':
                    case 'modtype_organizer':
                    case 'modtype_choicegroup':
                    case 'modtype_ratingallocate':
                        href = activity.querySelector('.aalink')?.href;
                        break;

                    case 'modtype_page': {
                        await chill();
                        const res = await fetch(activity.querySelector('.aalink')?.href);
                        const contentType = res.headers.get('Content-Type')?.replace?.(/;.*$/, '');
                        const body = await res.text();
                        const dom = parser.parseFromString(body, contentType || 'text/html');
                        contentHtml = dom.querySelector('#page-content').innerHTML;
                        break;
                    }

                    case 'modtype_resource': {
                        const resource = activity.querySelector('.aalink')?.href;
                        await chill();
                        const res = await fetch(resource);
                        const contentType = res.headers.get('Content-Type')?.replace?.(/;.*$/, '');
                        const body = await res.blob();
                        const filename = decodeURIComponent(new URL(res.url || resource)?.pathname?.split?.('/')?.pop?.());
                        zip.file(filename, body);
                        href = `./${encodeURIComponent(filename)}`;
                        break;
                    }

                    case 'modtype_folder': {
                        const resource = activity.querySelector('.aalink')?.href;
                        let root = activity.querySelector('.filemanager');

                        // walks the YUI tree view, downloads all files and
                        // returns the tree as [{ filename, isFolder, link, children }]
                        const fn = async (dir, path) => {
                            // does dir have a .ygtvtable?
                            const entry = dir.querySelector(':scope > .ygtvtable');
                            let node = null;
                            if (entry) {
                                const filename = entry.querySelector('.fp-filename')?.innerText;
                                const isFolder = entry.querySelector('.icon')?.src?.split?.('/')?.pop?.()?.includes?.('folder');
                                const fileHref = entry.querySelector('.fp-filename-icon > a[href]')?.href;
                                path = [...path, filename];
                                node = { filename, isFolder, link: null, children: [] };

                                if (fileHref) {
                                    await chill();
                                    const res = await fetch(fileHref);
                                    const body = await res.blob();
                                    zip.file(path.join('/'), body);
                                    node.link = `./${path.map(encodeURIComponent).join('/')}`;
                                }
                            }

                            // recurse downwards
                            const children = (await Promise.all([...dir.querySelectorAll(':scope > .ygtvchildren > .ygtvitem')].map(d => fn(d, path)))).flat();
                            if (node) {
                                node.children = children;
                                return [node];
                            }
                            return children;
                        };

                        if (!root && resource) {
                            await chill();
                            const res = await fetch(resource);
                            const contentType = res.headers.get('Content-Type')?.replace?.(/;.*$/, '');
                            const body = await res.text();
                            const dom = parser.parseFromString(body, contentType || 'text/html');
                            root = dom.querySelector('#page-content .filemanager');
                        }

                        if (root) {
                            const tree = (await Promise.all([...root.children].map(d => fn(d, [])))).flat();
                            const label = (n) => `${n.isFolder ? '📂' : '📝'} ${n.filename}`;
                            const renderHtml = (nodes) => nodes.length ? `<ul>${nodes.map((n) =>
                                `<li>${n.link ? `<a href="${escapeHtml(n.link)}">${escapeHtml(label(n))}</a>` : escapeHtml(label(n))}${renderHtml(n.children)}</li>`
                            ).join('')}</ul>` : '';
                            contentHtml = renderHtml(tree);
                        }

                        break;
                    }

                    case 'modtype_lti': {
                        href = activity.querySelector('.aalink')?.href;
                        const lti = activity.querySelector('.aalink')?.href?.replace?.('lti/view', 'lti/launch');
                        if (lti) {
                            await chill();
                            const res = await fetch(lti);
                            const contentType = res.headers.get('Content-Type')?.replace?.(/;.*$/, '');
                            const body = await res.text();
                            const dom = parser.parseFromString(body, contentType || 'text/html');
                            const form = dom.querySelector('#ltiLaunchForm');
                            const fd = new FormData(form);

                            if (fd.get('oauth_consumer_key') === 'OpencastMoodleLTI' && fd.get('custom_id')) {
                                await fetch(form.action, {
                                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                    body: new URLSearchParams(fd),
                                    credentials: 'include',
                                    method: 'POST',
                                });

                                await chill();
                                const res = await fetch(`${new URL(form.action).origin}/search/episode.json?id=${fd.get('custom_id')}`, {
                                    credentials: 'include'
                                });
                                const body = JSON.parse(await res.text());
                                const track = (body?.['search-results']?.result?.mediapackage?.media?.track || []).find(e => e.mimetype === 'video/mp4');
                                if (track?.url) {
                                    const res = await fetch(track.url, { credentials: 'include' });
                                    const blob = await res.blob();
                                    href = `./opencast/${fd.get('custom_id')}_${track.url.split('/').pop()}`;
                                    zip.file(href.slice(2), blob);
                                }
                            }
                        }
                        break;
                    }

                    case 'modtype_assign':
                        // todo
                        break;

                    default:
                        console.warn(`moodleport: unsupported activity type '${type}', saving link only`);
                        unsupported.set(type, (unsupported.get(type) || 0) + 1);
                        href = activity.querySelector('.aalink')?.href;
                        break;
                }

                if (type !== 'modtype_label') {
                    const name = activity.querySelector('[data-activityname]')?.dataset?.activityname;
                    const label = `${icon[type] ?? '🔗'} ${name}`;
                    if (name && href) {
                        html += `<h3><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></h3>\n`;
                    } else if (name) {
                        html += `<h3>${escapeHtml(label)}</h3>\n`;
                    }
                }

                if (type !== 'modtype_folder') {
                    const description = activity.querySelector('.description')?.innerHTML;
                    if (description) {
                        html += `<blockquote>${cleanHtml(description)}</blockquote>\n`;
                    }
                }

                if (contentHtml) {
                    html += cleanHtml(contentHtml) + '\n';
                }
            } catch (e) {
                console.log(e);
            }

            current += 1;
            updateProgress(current, total);
        }

        current += 1;
        updateProgress(current, total);
    }

    // dedent the template before inserting the content, so that indentation
    // inside the course's own markup (e.g. in <pre> blocks) is preserved
    zip.file('index.html', `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${escapeHtml(course || 'Moodle course backup')}</title>
          <style>
            body { font-family: system-ui, sans-serif; line-height: 1.5; max-width: 50em; margin: 0 auto; padding: 1em; color: #222; }
            h2 { border-bottom: 1px solid #ccc; margin-top: 2em; }
            blockquote { margin-inline: 0; padding-left: 1em; border-left: 3px solid #ccc; color: #555; }
            img, video, iframe { max-width: 100%; height: auto; }
            table { border-collapse: collapse; }
            td, th { border: 1px solid #ccc; padding: .25em .5em; }
          </style>
        </head>
        <body>
          <!-- content -->
        </body>
      </html>
    `.replace(/^ {6}/gm, '').trim().replace('<!-- content -->', () => html));

    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, `${course.replace(/[^A-Za-z0-9]/gi, '_')}.zip`);

    if (unsupported.size === 0) {
        loader.remove();
        return;
    }

    content.style.maxHeight = '80vh';
    content.style.maxWidth = '400px';
    content.style.overflowY = 'auto';
    content.style.textAlign = 'left';
    content.replaceChildren();

    const heading = document.createElement('h2');
    heading.innerText = '⚠️ Export finished with warnings';
    content.appendChild(heading);

    const explanation = document.createElement('p');
    explanation.innerText = 'The following activity types are not supported yet. Only a link to them was saved in the backup:';
    content.appendChild(explanation);

    const list = document.createElement('ul');
    for (const [type, count] of unsupported) {
        const item = document.createElement('li');
        item.innerText = `${type.replace(/^modtype_/, '')} (${count}×)`;
        list.appendChild(item);
    }
    content.appendChild(list);

    const issue = document.createElement('p');
    issue.innerHTML = 'Feel free to report them on <a href="https://github.com/ech0-de/moodleport/issues" target="_blank" rel="noreferrer noopener">GitHub</a>.';
    content.appendChild(issue);

    const close = document.createElement('button');
    close.innerText = 'Close';
    close.addEventListener('click', () => loader.remove());
    content.appendChild(close);
})().then(console.log).catch(console.log);
