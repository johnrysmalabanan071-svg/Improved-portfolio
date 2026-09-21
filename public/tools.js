// Edit these lists to change the displayed tools. Icons are local files.
export const toolGroups = [
  { label: 'AUTOMATION, AI & DEVELOPMENT', tools: [
    ['n8n','n8n'], ['Make.com','make'], ['Zapier','zapier'], ['GoHighLevel','highlevel'],
    ['OpenAI','openai'], ['Claude','claude'], ['Vapi','vapi'], ['Airtable','airtable'],
    ['HubSpot','hubspot'], ['Apollo','apollo'], ['Asana','asana'], ['Xero','xero'],
    ['Supabase','supabase'], ['Vercel','vercel'], ['GitHub','github'], ['Python','python'],
    ['JavaScript','javascript'], ['REST APIs','rest-api'], ['Webhooks','webhooks'], ['SQL','sql'], ['Google Cloud','google-cloud']
  ]},
  { label: 'GOOGLE WORKSPACE & COLLABORATION', tools: [
    ['Google Workspace','google-workspace'], ['Gmail','gmail'], ['Google Drive','google-drive'],
    ['Google Docs','google-docs'], ['Google Sheets','google-sheets'], ['Google Slides','google-slides'],
    ['Google Calendar','google-calendar'], ['Google Meet','google-meet'], ['Google Forms','google-forms'],
    ['Google Apps Script','google-apps-script'], ['Slack','slack'], ['Calendly','calendly']
  ]}
];

const section = typeof document === 'undefined' ? null : document.querySelector('#tools');
if (section) {
  const rows = section.querySelector('#tools-rows');
  const pause = section.querySelector('#tools-pause');
  const view = section.querySelector('#tools-view');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = false, expanded = false;
  for (const group of toolGroups) {
    const label = document.createElement('p'); label.className = 'tools-row-label'; label.textContent = group.label;
    const rail = document.createElement('div'); rail.className = 'tools-rail';
    const track = document.createElement('div'); track.className = 'tools-track';
    const list = document.createElement('ul'); list.className = 'tools-group'; list.setAttribute('aria-label', group.label.toLowerCase());
    for (const [name, file] of group.tools) {
      const item = document.createElement('li'); item.className = 'tool-chip';
      const icon = document.createElement('img'); icon.src = `/assets/tools/${file}.svg`; icon.alt = ''; icon.width = 28; icon.height = 28; icon.decoding = 'async';
      const text = document.createElement('span'); text.textContent = name;
      item.append(icon, text); list.append(item);
    }
    const copy = list.cloneNode(true); copy.setAttribute('aria-hidden','true'); copy.removeAttribute('aria-label'); copy.inert = true;
    track.append(list,copy); rail.append(track); rows.append(label,rail);
  }
  section.querySelector('.tools-controls').hidden = false;
  function update() {
    section.classList.toggle('is-paused', paused);
    section.classList.toggle('show-all', expanded);
    pause.disabled = reduced.matches || expanded;
    pause.setAttribute('aria-pressed', String(paused || reduced.matches || expanded));
    pause.textContent = reduced.matches ? 'Motion reduced' : expanded ? 'Motion paused' : paused ? 'Play motion' : 'Pause motion';
    view.hidden = reduced.matches;
    view.textContent = expanded ? 'Show moving strip' : 'View all tools';
    view.setAttribute('aria-expanded', String(expanded));
  }
  pause.addEventListener('click', () => { paused = !paused; update(); });
  view.addEventListener('click', () => { expanded = !expanded; update(); });
  reduced.addEventListener('change', update);
  const visibility = () => section.classList.toggle('is-hidden', document.hidden);
  document.addEventListener('visibilitychange', visibility);
  visibility(); update();
}
