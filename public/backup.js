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
        'modtype_folder': '📂',
        'modtype_zoom': '☎️',
        'modtype_url': '🌍',
        'modtype_lti': '⛓️',
        'modtype_quiz': '✅'
    };
    const externalScripts = [
        'https://unpkg.com/turndown/dist/turndown.js',
        'https://unpkg.com/turndown-plugin-gfm/dist/turndown-plugin-gfm.js',
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

    let output = '';

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

    const td = new TurndownService();
    td.use(turndownPluginGfm.gfm);

    const course = document.querySelector('.page-header-headings h1')?.innerText || '';
    if (course) {
        output += `# ${course}\n\n`;
    }

    let current = 0;
    const total = document.querySelectorAll('.course-section').length + document.querySelectorAll('.activity').length;
    updateProgress(current, total);

    for (const section of document.querySelectorAll('.course-section')) {
        const title = section.querySelector('.sectionname')?.innerText || '';
        if (title) {
            output += `## ${title}\n\n`;
        }

        for (const activity of section.querySelectorAll('.activity')) {
            try {
                const type = [...activity.classList].find(e => String(e).startsWith('modtype_'));
                let content = null;
                let href = null;

                switch (type) {
                    case 'modtype_label':
                        content = td.turndown(activity.innerHTML);
                        break;

                    case 'modtype_url':
                    case 'modtype_zoom':
                    case 'modtype_quiz':
                    case 'modtype_forum':
                    case 'modtype_feedback':
                    case 'modtype_organizer':
                    case 'modtype_choicegroup':
                        href = activity.querySelector('.aalink')?.href;
                        break;

                    case 'modtype_page': {
                        await chill();
                        const res = await fetch(activity.querySelector('.aalink')?.href);
                        const contentType = res.headers.get('Content-Type')?.replace?.(/;.*$/, '');
                        const body = await res.text();
                        const dom = parser.parseFromString(body, contentType || 'text/html');
                        content = td.turndown(dom.querySelector('#page-content').innerHTML);
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
                        const root = activity.querySelector('.filemanager');

                        const fn = async (dir, path=[]) => {
                            // does dir have a .ygtvtable?
                            const entry = dir.querySelector(':scope > .ygtvtable');
                            if (entry) {
                                const filename = entry.querySelector('.fp-filename')?.innerText;
                                const isFolder = entry.querySelector('.icon')?.src?.split?.('/')?.pop?.()?.includes?.('folder');
                                const href = entry.querySelector('.fp-filename-icon > a[href]')?.href;
                                path.push(filename);

                                if (href) {
                                    await chill();
                                    const res = await fetch(href);
                                    const body = await res.blob();
                                    zip.file(path.join('/'), body);
                                    content += `${Array(path.length).fill('  ').join('')} * [${isFolder ? '📂' : '📝'} ${filename}](./${path.map(encodeURIComponent).join('/')})\n`;
                                } else {
                                    content += `${Array(path.length).fill('  ').join('')} * ${isFolder ? '📂' : '📝'} ${filename}\n`;
                                }
                            }
                            
                            // recurse downwards
                            await Promise.all([...dir.querySelectorAll(':scope > .ygtvchildren > .ygtvitem')].map(d => fn(d, [...path])));
                        };

                        if (root) {
                            await Promise.all([...root.children].map(d => fn(d, [])));
                        } else if (resource) {
                            await chill();
                            const res = await fetch(resource);
                            const contentType = res.headers.get('Content-Type')?.replace?.(/;.*$/, '');
                            const body = await res.text();
                            const dom = parser.parseFromString(body, contentType || 'text/html');
                            const root = dom.querySelector('#page-content .filemanager');
                            if (root) {
                                await Promise.all([...root.children].map(d => fn(d, [])));
                            }
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
                        alert(`Encountered unsupported activity type '${type}'`);
                        break;
                }

                if (type !== 'modtype_label') {
                    const name = activity.querySelector('[data-activityname]')?.dataset?.activityname;
                    if (name && href) {
                        output += `### [${icon[type]} ${name}](${href})\n\n`;
                    } else if (name) {
                        output += `### ${icon[type]} ${name}\n\n`;
                    }
                }

                if (type !== 'modtype_folder') {
                    const description = activity.querySelector('.description')?.innerHTML;
                    if (description) {
                        output += td.turndown(`<blockquote>${description}</blockquote>`) + '\n\n';
                    }
                }

                if (content) {
                     output += content + '\n\n'
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

    zip.file("README.md", output);

    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, `${course.replace(/[^A-Za-z0-9]/gi, '_')}.zip`);

    loader.remove();
})().then(console.log).catch(console.log);
