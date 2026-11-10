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
    // vendored next to this script, see scripts/vendor.mjs
    const externalScripts = [
        'vendor/jszip/jszip.min.js'
    ].map((path) => new URL(path, import.meta.url).href);

    window.define = null;
    window.require = null;
    const scriptsReady = Promise.all(externalScripts.map((script) => new Promise((resolve, reject) => {
        const st = document.createElement('script');
        st.src = script;
        st.addEventListener('load', resolve);
        st.addEventListener('error', () => reject(new Error(`moodleport: failed to load ${script}`)));
        document.body.appendChild(st);
    })));

    let html = '';
    const unsupported = new Map();

    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    // turns a name taken from Moodle into a single, harmless path segment,
    // so that ZIP entries can't escape the extraction directory (zip slip)
    const safeName = (name) => String(name ?? '')
        .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
        .replace(/^\.+$/, '_') || '_';
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

    // data-activityname holds Moodle's formatted name, i.e. HTML like "A &amp; B"
    const activityName = (activity) => {
        const name = activity.querySelector('[data-activityname]')?.dataset?.activityname;
        return name === undefined ? undefined : parser.parseFromString(name, 'text/html').body.textContent;
    };

    // the course page as sent by the server, before Moodle's JavaScript changed it
    let coursePage = null;
    const getCoursePage = async () => {
        if (!coursePage) {
            await chill();
            coursePage = parser.parseFromString(await (await fetch(location.href)).text(), 'text/html');
        }
        return coursePage;
    };

    const course = document.querySelector('.page-header-headings h1')?.innerText || '';
    if (course) {
        html += `<h1>${escapeHtml(course)}</h1>\n`;
    }

    // a section's own activities, without those of a subsection (Moodle 4.5+), which is
    // an activity containing its own .course-section
    const activitiesOf = (section) => [...section.querySelectorAll('.activity')]
        .filter((a) => a.parentElement.closest('.course-section') === section);

    // sections and activities in order, with their heading level
    const entries = [];
    for (const section of document.querySelectorAll('.course-section')) {
        if (section.parentElement.closest('.activity')) {
            continue; // subsection, added below
        }
        entries.push({ section, level: 2 });
        for (const activity of activitiesOf(section)) {
            const subsection = activity.querySelector('.course-section');
            if (subsection) {
                entries.push({ section: subsection, level: 3 });
                entries.push(...activitiesOf(subsection).map((a) => ({ activity: a, level: 4 })));
            } else {
                entries.push({ activity, level: 3 });
            }
        }
    }

    let current = 0;
    updateProgress(current, entries.length);

    for (const { section, activity, level } of entries) {
        if (section) {
            const title = section.querySelector('.sectionname')?.innerText || '';
            if (title) {
                html += `<h${level}>${escapeHtml(title)}</h${level}>\n`;
            }
        } else {
            try {
                const type = [...activity.classList].find(e => String(e).startsWith('modtype_'));
                let contentHtml = null;
                let href = null;

                switch (type) {
                    case 'modtype_label': {
                        // just the label's text, without Moodle's activity markup (e.g. the bulk edit checkbox)
                        const text = activity.querySelector('.description-inner') || activity.querySelector('.activity-altcontent');
                        contentHtml = (text || activity).innerHTML;
                        break;
                    }

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
                        // just the page's text, without the surrounding layout (header, "Last modified", ...)
                        contentHtml = (dom.querySelector('#page-content [role=main] > .generalbox') || dom.querySelector('#page-content')).innerHTML;
                        break;
                    }

                    case 'modtype_resource': {
                        const resource = activity.querySelector('.aalink')?.href;
                        await chill();
                        const res = await fetch(resource);
                        const contentType = res.headers.get('Content-Type')?.replace?.(/;.*$/, '');
                        const body = await res.blob();
                        const filename = safeName(decodeURIComponent(new URL(res.url || resource)?.pathname?.split?.('/')?.pop?.()));
                        zip.file(filename, body);
                        href = `./${encodeURIComponent(filename)}`;
                        break;
                    }

                    case 'modtype_folder': {
                        // parse the server's HTML, not the live DOM (Moodle <= 4.2 turns it into a YUI tree):
                        // nested <ul><li>, labelled by .fp-filename-icon (<= 4.2) or <p> (4.3+)
                        const resource = activity.querySelector('.aalink')?.href;
                        let root = null;
                        if (resource) {
                            await chill();
                            const res = await fetch(resource);
                            const contentType = res.headers.get('Content-Type')?.replace?.(/;.*$/, '');
                            const dom = parser.parseFromString(await res.text(), contentType || 'text/html');
                            root = dom.querySelector('#page-content .filemanager');
                        } else {
                            root = (await getCoursePage()).getElementById(activity.id)?.querySelector('.filemanager');
                        }

                        // downloads all files below li and returns its tree as { filename, isFolder, link, children }
                        const walk = async (li, path) => {
                            const label = li.querySelector(':scope > .fp-filename-icon, :scope > p')?.cloneNode(true);
                            label?.querySelectorAll('.visually-hidden').forEach((e) => e.remove());
                            const filename = label?.textContent?.replace(/\s+/g, ' ')?.trim() || '';
                            const isFolder = /\/f\/folder/.test(label?.querySelector('img.icon')?.src || '');
                            const fileHref = label?.querySelector('a[href]')?.href;
                            path = [...path, safeName(filename)];
                            const node = { filename, isFolder, link: null, children: [] };

                            if (fileHref) {
                                await chill();
                                const res = await fetch(fileHref);
                                const body = await res.blob();
                                zip.file(path.join('/'), body);
                                node.link = `./${path.map(encodeURIComponent).join('/')}`;
                            }

                            node.children = await Promise.all([...li.querySelectorAll(':scope > ul > li')].map((c) => walk(c, path)));
                            return node;
                        };

                        if (root) {
                            // the top-level entry is the folder itself (unnamed on the folder's own page),
                            // so its contents are stored in a directory named after the activity
                            const name = activityName(activity);
                            const top = [...root.querySelectorAll(':scope > ul > li > ul > li')];
                            const tree = await Promise.all(top.map((li) => walk(li, [safeName(name)])));
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
                                    const filename = safeName(`${fd.get('custom_id')}_${track.url.split('/').pop()}`);
                                    zip.file(`opencast/${filename}`, blob);
                                    href = `./opencast/${encodeURIComponent(filename)}`;
                                }
                            }
                        }
                        break;
                    }

                    case 'modtype_assign': {
                        href = activity.querySelector('.aalink')?.href;
                        if (!href) {
                            break;
                        }

                        await chill();
                        const res = await fetch(href);
                        const contentType = res.headers.get('Content-Type')?.replace?.(/;.*$/, '');
                        const dom = parser.parseFromString(await res.text(), contentType || 'text/html');

                        // downloads the files linked as .../<area>/<itemid>/<path> into dir, returns a list of them
                        const download = async (selector, area, dir) => {
                            const items = [];
                            for (const url of new Set([...dom.querySelectorAll(selector)].map((a) => a.href))) {
                                const path = new URL(url).pathname.split(`/${area}/`)[1]
                                    .split('/').slice(1).map((p) => safeName(decodeURIComponent(p)));
                                const zipPath = [...dir, ...path];
                                await chill();
                                zip.file(zipPath.join('/'), await (await fetch(url)).blob());
                                items.push(`<li><a href="./${zipPath.map(encodeURIComponent).join('/')}">📝 ${escapeHtml(path.join('/'))}</a></li>`);
                            }
                            return items.length ? `<ul>${items.join('')}</ul>` : '';
                        };

                        // files attached to the description (e.g. the task sheet), only shown on the assignment's page
                        const dir = safeName(activityName(activity));
                        contentHtml = await download('#intro a[href*="/mod_assign/introattachment/"]', 'mod_assign/introattachment', [dir]);
                        break;
                    }

                    default:
                        console.warn(`moodleport: unsupported activity type '${type}', saving link only`);
                        unsupported.set(type, (unsupported.get(type) || 0) + 1);
                        href = activity.querySelector('.aalink')?.href;
                        break;
                }

                if (type !== 'modtype_label') {
                    const name = activityName(activity);
                    const label = `${icon[type] ?? '🔗'} ${name}`;
                    if (name && href) {
                        html += `<h${level}><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></h${level}>\n`;
                    } else if (name) {
                        html += `<h${level}>${escapeHtml(label)}</h${level}>\n`;
                    }
                }

                // a label's text is its description, so it's already in contentHtml
                if (type !== 'modtype_folder' && type !== 'modtype_label') {
                    // .activity-description since Moodle 4.3, .description before
                    const description = (activity.querySelector('.activity-description') || activity.querySelector('.description .description-inner') || activity.querySelector('.description'))?.innerHTML;
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
        }

        current += 1;
        updateProgress(current, entries.length);
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
    const downloadUrl = URL.createObjectURL(blob);
    const download = document.createElement('a');
    download.href = downloadUrl;
    download.download = `${course.replace(/[^A-Za-z0-9]/gi, '_')}.zip`;
    document.body.appendChild(download);
    download.click();
    download.remove();
    // revoking right away can abort the download in some browsers
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 60 * 1000);

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
