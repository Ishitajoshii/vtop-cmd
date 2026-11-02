const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { discover, search } = require('../navigation');
const fixture = fs.readFileSync(__dirname + '/fixture.html', 'utf8');
function setup({ signedIn = true, savedDark = false, savedSemester, savedKnown, fetch, html, platform } = {}) {
  const dom = new JSDOM(html || (signedIn ? fixture : '<!doctype html><html><body><form>Sign in</form></body></html>'), { runScripts: 'outside-only', url: 'https://vtop.vit.ac.in/vtop/content' });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  const writes = [];
  w.chrome = { storage: { local: { get: async () => ({ darkMode: savedDark, defaultSemester: savedSemester, knownSemesters: savedKnown }), set: async value => writes.push(value) }, onChanged: { addListener(listener) { (w.storageListeners ||= []).push(listener); } } } };
  if (fetch) w.fetch = fetch;
  if (platform) Object.defineProperty(w.navigator, 'platform', { value: platform, configurable: true });
  w.eval(fs.readFileSync(__dirname + '/../brand.js', 'utf8'));
  w.eval(fs.readFileSync(__dirname + '/../combobox.js', 'utf8'));
  w.eval(fs.readFileSync(__dirname + '/../navigation.js', 'utf8'));
  w.eval(fs.readFileSync(__dirname + '/../semesters.js', 'utf8'));
  w.eval(fs.readFileSync(__dirname + '/../content.js', 'utf8'));
  const shadow = w.document.querySelector('#vtop-command-root').shadowRoot;
  const key = (value, options = {}, target = w.document) => target.dispatchEvent(new w.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options }));
  const query = value => { const input = shadow.querySelector('.search input'); input.value = value; input.dispatchEvent(new w.Event('input')); };
  return { dom, w, shadow, key, query, writes };
}
test('discovers hidden Bootstrap 5 and legacy menu destinations, deduplicates quick links, preserves subcategories', () => {
  const dom = new JSDOM(fixture), commands = discover(dom.window.document);
  assert.equal(commands.length, 10);
  assert.equal(commands.find(c => c.label === 'Time Table').category, 'Academics');
  assert.equal(commands.filter(c => c.label === 'Exam Schedule').length, 2);
  assert.match(commands.find(c => c.id.includes('viewRAR')).category, /Arrear/);
  assert.ok(!JSON.stringify(commands).includes('Must never be indexed'));
  assert.ok(!commands.some(c => /disabled|logout|delete/i.test(c.id)));
  dom.window.close();
});
test('finds aliases, categories, mixed-word queries, acronyms, and partial spellings', () => {
  const dom = new JSDOM(fixture), commands = discover(dom.window.document);
  for (const [query, expected] of [['timetable','Time Table'],['da','Digital Assignment Upload'],['cgpa','Grade History'],['attendnce','Class Attendance'],['tt','Time Table'],['finance receipts','Payment Receipts']]) assert.equal(search(commands, query)[0]?.label, expected, query);
  assert.equal(search(commands,'qzqzqz').length, 0);
  assert.equal(search(commands,'arrear')[0].label,'Exam Schedule');
  dom.window.close();
});
test('Ctrl+K toggles (Windows/Linux); keyboard selection invokes the existing page handler once and restores focus', async () => {
  const {dom,w,shadow,key,query}=setup();
  const focus = w.document.querySelector('#before'); focus.focus();
  let clicks=0, submits=0;
  w.document.querySelector('[data-url="examinations/StudentDA"]').addEventListener('click', e=>{e.preventDefault();clicks++;});
  w.document.querySelector('form').addEventListener('submit',()=>submits++);
  key('k',{ctrlKey:true}); assert.equal(shadow.querySelector('dialog').open,true);
  query('da'); key('ArrowDown',{},shadow.querySelector('.search input')); key('ArrowUp',{},shadow.querySelector('.search input')); key('Enter',{},shadow.querySelector('.search input'));
  assert.equal(clicks,1); assert.equal(submits,0); assert.equal(shadow.querySelector('dialog').open,false); assert.equal(w.document.activeElement,focus);
  key('k',{ctrlKey:true}); assert.equal(shadow.querySelector('dialog').open,true);
  key('k',{ctrlKey:true}); assert.equal(shadow.querySelector('dialog').open,false);
  dom.window.close();
});
test('re-resolves native elements after AJAX replacement and discovers newly inserted pages', async () => {
  const {dom,w,shadow,key,query}=setup(); key('k',{ctrlKey:true}); query('attendance');
  const original=w.document.querySelector('[data-url="academics/common/StudentAttendance"]');
  const replacement=original.cloneNode(true); let clicks=0; replacement.addEventListener('click',e=>{e.preventDefault(); clicks++;}); original.replaceWith(replacement);
  key('Enter',{},shadow.querySelector('.search input')); assert.equal(clicks,1);
  const page=w.document.createElement('a'); page.className='systemBtnMenu'; page.dataset.url='new/page'; page.textContent='New Page'; w.document.querySelector('.list-group').append(page);
  key('k',{ctrlKey:true}); query('new page'); assert.match(shadow.querySelector('[role=option]').textContent,/New Page/);
  dom.window.close();
});
test('empty results, signed-out state, and theme restore/toggle without persisting account data', async () => {
  const {dom,w,shadow,key,query,writes}=setup({signedIn:false,savedDark:true});
  await Promise.resolve(); await Promise.resolve();
  assert.ok(w.document.documentElement.hasAttribute('data-vtop-command-dark'));
  key('k',{ctrlKey:true}); assert.match(shadow.textContent,/Sign in to VTOP/);
  shadow.querySelector('.theme').click(); assert.ok(!w.document.documentElement.hasAttribute('data-vtop-command-dark')); assert.deepEqual(writes.map(v=>Object.keys(v)),[['darkMode']]);
  query('zzzzzz'); assert.match(shadow.querySelector('.results').textContent,/No pages found/); key('Enter',{},shadow.querySelector('.search input'));
  dom.window.close();
});
test('manifest has storage and offscreen permissions with VTOP-only content scope, all shipped files exist',()=>{
  const manifest=JSON.parse(fs.readFileSync(__dirname+'/../manifest.json'));
  assert.equal(manifest.manifest_version,3); assert.deepEqual(manifest.permissions,['storage','offscreen']);
  assert.deepEqual(manifest.content_scripts[0].matches,['https://vtop.vit.ac.in/vtop/*']);
  for(const file of [...manifest.content_scripts[0].js,...manifest.content_scripts[0].css]) assert.ok(fs.existsSync(__dirname+'/../'+file));
});

const semesters = require('../semesters');
const semesterHTML = `<label for="semesterSubId">Semester</label><select id="semesterSubId" name="semesterSubId"><option value="">--Choose Semester--</option><option value="VL20262701">Fall Semester 2026-27</option><option value="VL20252605">Winter Semester 2025-26</option></select>`;
const savedSemester = {value:'VL20262701',label:'Fall Semester 2026-27'};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const pause = () => new Promise(resolve=>setTimeout(resolve,160));

test('semester matching handles campus suffixes and alternate IDs, rejects unavailable/ambiguous terms and unrelated controls', () => {
  const dom=new JSDOM(semesterHTML + '<select id="course"><option>Fall Semester 2026-27</option></select>');
  const select=semesters.discover(dom.window.document)[0];
  assert.equal(semesters.discover(dom.window.document).length,1);
  assert.equal(semesters.options(select).length,2);
  assert.equal(semesters.match(select,savedSemester).value,'VL20262701');
  select.options[1].value='different-id'; select.options[1].textContent='Fall Semester 2026-2027 - VLR';
  assert.equal(semesters.match(select,savedSemester).value,'different-id');
  assert.equal(semesters.match(select,{value:'missing',label:'Summer Semester 2026-27'}),null);
  select.add(new dom.window.Option('Fall Semester 2026-27','another-id'));
  assert.equal(semesters.match(select,savedSemester),null);
  dom.window.close();
});

test('first semester page prompts, saving selects the default and dispatches exactly one native change', async () => {
  const {dom,w,shadow,writes}=setup({html:semesterHTML});
  const select=w.document.querySelector('select'); let changes=0,submits=0;
  select.addEventListener('change',()=>changes++);
  w.document.addEventListener('submit',()=>submits++);
  await flush();
  assert.equal(shadow.querySelector('dialog').open,true);
  assert.equal(shadow.querySelector('.semester-settings').hidden,false);
  assert.equal(changes,0);
  const picker=shadow.querySelector('#default-semester'); picker.value='0'; picker.dispatchEvent(new w.Event('change'));
  shadow.querySelector('.save-semester').click(); await pause();
  assert.equal(select.value,savedSemester.value); assert.equal(changes,1); assert.equal(submits,0);
  assert.equal(writes.find(write=>'defaultSemester' in write).defaultSemester.label,savedSemester.label);
  assert.equal(shadow.querySelector('dialog').open,false);
  dom.window.close();
});

test('the default semester is applied once per page visit; re-renders keep a manual choice, a new page applies it again', async () => {
  const {dom,w,shadow}=setup({html:semesterHTML,savedSemester});
  const select=w.document.querySelector('select'); let changes=0;
  select.addEventListener('change',()=>changes++); await flush();
  assert.equal(select.value,savedSemester.value); assert.equal(changes,1);
  assert.equal(shadow.querySelector('dialog').open,false);
  // You pick another semester; VTOP re-renders the page with a new dropdown. Your choice stays.
  select.value='VL20252605'; select.dispatchEvent(new w.Event('change',{bubbles:true}));
  w.document.body.append(w.document.createElement('p')); await pause();
  assert.equal(select.value,'VL20252605'); assert.equal(changes,2);
  const rerender=w.document.createElement('select'); rerender.id='semesterSubId';
  rerender.innerHTML='<option value="">Choose semester</option><option value="VL20252605">Winter Semester 2025-26</option><option value="other-id">Fall Semester 2026-27 - VLR</option>';
  rerender.value='VL20252605'; let rerenderChanges=0; rerender.addEventListener('change',()=>rerenderChanges++);
  select.replaceWith(rerender); await pause(); await pause();
  assert.equal(rerender.value,'VL20252605'); assert.equal(rerenderChanges,0);
  // Opening a page from VTOP's menu starts a new visit: its dropdown gets the default once, even when options load late.
  const link=w.document.createElement('a'); link.className='systemB5BtnMenu'; link.dataset.url='academics/common/StudentTimeTable'; link.href='#';
  link.addEventListener('click',event=>event.preventDefault()); w.document.body.append(link); link.click();
  const next=w.document.createElement('select'); next.id='semesterSubId'; next.innerHTML='<option value="">Choose semester</option>';
  let nextChanges=0; next.addEventListener('change',()=>nextChanges++);
  rerender.replaceWith(next); await pause(); assert.equal(next.value,''); assert.equal(rerender.value,'VL20252605','the page being left is not changed');
  next.add(new w.Option('Fall Semester 2026-27 - VLR','other-id')); await pause();
  assert.equal(next.value,'other-id'); assert.equal(nextChanges,1);
  next.innerHTML='<option value="">Choose semester</option><option value="old">Fall Semester 2024-25</option>';
  await pause(); assert.equal(next.value,''); assert.equal(nextChanges,1);
  dom.window.close();
});

test('semester controls keep native arrow/Enter behavior; turning auto-selection off persists', async () => {
  const {dom,w,shadow,key,writes}=setup({html:semesterHTML,savedSemester}); await flush();
  shadow.querySelector('.semester-button').click();
  const picker=shadow.querySelector('#default-semester');
  assert.equal(key('ArrowDown',{},picker),true);
  assert.equal(key('Enter',{},picker),true);
  shadow.querySelector('.clear-semester').click();
  assert.equal(writes.filter(write=>'defaultSemester' in write).at(-1).defaultSemester,null);
  const replacement=w.document.createElement('div'); replacement.innerHTML=semesterHTML;
  w.document.querySelector('select').replaceWith(replacement); await pause();
  assert.equal(replacement.querySelector('select').value,'');
  dom.window.close();
  const off=setup({html:semesterHTML,savedSemester:null}); await flush();
  assert.equal(off.shadow.querySelector('dialog').open,false); off.dom.window.close();
});

const signedInHTML = fs.readFileSync(__dirname + '/fixture.html', 'utf8').replace('</body>', '<input type="hidden" id="authorizedIDX" value="TEST-ID"><input type="hidden" name="_csrf" value="test-csrf"></body>');
const terms = [{value:'VL20262701',label:'Fall Semester 2026-27'},{value:'VL20252605',label:'Winter Semester 2025-26'}];
test('picker lists remembered semesters on pages without a semester dropdown', async () => {
  let fetches=0;
  const {dom,shadow}=setup({html:signedInHTML,savedKnown:{list:terms,updated:Date.now()},fetch:async()=>{fetches++;throw new Error('offline');}}); await flush();
  assert.equal(shadow.querySelector('dialog').open,false,'remembered terms alone do not prompt');
  shadow.querySelector('.semester-chip').click();
  const picker=shadow.querySelector('#default-semester');
  assert.deepEqual([...picker.options].slice(1).map(o=>o.textContent),terms.map(t=>t.label));
  assert.equal(picker.disabled,false); assert.equal(fetches,0,'a fresh cache needs no request');
  dom.window.close();
});
test('empty picker loads semesters from Time Table with the menu request, then saves the list', async () => {
  const calls=[];
  const fetch=async (url,init)=>{calls.push({url:String(url),init});return {ok:true,text:async()=>'<div><script>throw 1</script>'+semesterHTML+'</div>'};};
  const {dom,shadow,writes}=setup({html:signedInHTML,fetch}); await flush();
  shadow.querySelector('.semester-chip').click();
  assert.match(shadow.querySelector('.semester-status').textContent,/Loading semesters/);
  await pause();
  assert.equal(calls.length,1); assert.equal(calls[0].url,'https://vtop.vit.ac.in/vtop/academics/common/StudentTimeTable');
  assert.equal(calls[0].init.method,'POST'); assert.equal(calls[0].init.credentials,'same-origin');
  const body=calls[0].init.body; assert.equal(body.get('verifyMenu'),'true'); assert.equal(body.get('authorizedID'),'TEST-ID'); assert.equal(body.get('_csrf'),'test-csrf');
  const picker=shadow.querySelector('#default-semester');
  assert.deepEqual([...picker.options].slice(1).map(o=>o.textContent),terms.map(t=>t.label));
  assert.equal(JSON.stringify(writes.find(w=>w.knownSemesters).knownSemesters.list),JSON.stringify(terms));
  shadow.querySelector('.skip-semester').click(); shadow.querySelector('.semester-chip').click(); await pause();
  assert.equal(calls.length,1,'one request per page load');
  dom.window.close();
});
test('failed semester load explains the fallback and offers Time Table', async () => {
  const {dom,w,shadow}=setup({html:signedInHTML,fetch:async()=>({ok:true,text:async()=>'<p>___INTERNAL___RESPONSE___</p>'})}); await flush();
  let opened=0; w.document.querySelector('[data-url="academics/common/StudentTimeTable"].systemB5BtnMenu').addEventListener('click',e=>{e.preventDefault();opened++;});
  shadow.querySelector('.semester-chip').click(); await pause();
  assert.match(shadow.querySelector('.semester-status').textContent,/Couldn't load semesters/);
  assert.equal(shadow.querySelector('#default-semester').disabled,true);
  const button=shadow.querySelector('.open-timetable'); assert.equal(button.hidden,false);
  button.click(); assert.equal(opened,1); assert.equal(shadow.querySelector('dialog').open,false);
  dom.window.close();
});
test('semesters seen on a page are remembered without rewriting storage on every scan', async () => {
  const {dom,w,writes}=setup({html:semesterHTML,savedSemester}); await flush();
  const saved=writes.filter(write=>write.knownSemesters);
  assert.equal(saved.length,1); assert.equal(JSON.stringify(saved[0].knownSemesters.list),JSON.stringify(terms));
  w.document.body.append(w.document.createElement('p')); await pause();
  assert.equal(writes.filter(write=>write.knownSemesters).length,1);
  dom.window.close();
});
test('Windows/Linux use and show Ctrl+K only; macOS uses and shows Cmd+K; physical K works on any layout', () => {
  for (const platform of ['Win32','Linux x86_64']) {
    const {dom,shadow,key}=setup({platform});
    assert.equal(shadow.querySelector('.shortcut').textContent,'Ctrl K');
    key('k',{metaKey:true}); assert.equal(shadow.querySelector('dialog').open,false,'Windows key + K is left to the OS');
    key('л',{ctrlKey:true,code:'KeyK'}); assert.equal(shadow.querySelector('dialog').open,true,'non-Latin layout');
    key('K',{ctrlKey:true}); assert.equal(shadow.querySelector('dialog').open,false,'Caps Lock');
    key('k',{ctrlKey:true,shiftKey:true}); assert.equal(shadow.querySelector('dialog').open,false);
    dom.window.close();
  }
  const mac=setup({platform:'MacIntel'});
  assert.equal(mac.shadow.querySelector('.shortcut').textContent,'⌘ K');
  mac.key('k',{ctrlKey:true}); assert.equal(mac.shadow.querySelector('dialog').open,false,'Ctrl+K stays native on macOS');
  mac.key('k',{metaKey:true}); assert.equal(mac.shadow.querySelector('dialog').open,true);
  mac.dom.window.close();
});
test('launcher is a minimal pill: logo, platform shortcut and semester only', () => {
  const {dom,shadow}=setup({platform:'Win32'});
  const dock=shadow.querySelector('.dock');
  assert.deepEqual([...dock.children].map(node=>node.className),['launcher','sep','semester-chip']);
  assert.equal(dock.querySelector('.launcher').textContent.trim(),'Ctrl K');assert.equal(dock.querySelector('.launcher').getAttribute('aria-label'),'Open VTOP command menu');
  assert.equal(dock.querySelector('.semester-chip').textContent,'Set semester');assert.ok(!dock.textContent.includes('Tools'));
  dom.window.close();
});
test('Home command opens VTOP home through its own header link', async () => {
  const html=fs.readFileSync(__dirname + '/fixture.html', 'utf8').replace('<nav id="top-hmenu-bar">','<a id="home" href="javascript:void(0);" onclick="javascript:home();"><i class="bi bi-house-door"></i></a><nav id="top-hmenu-bar">');
  const {dom,w,shadow,key,query}=setup({html,platform:'Win32'});let homes=0;
  w.document.querySelector('#home').addEventListener('click',event=>{event.preventDefault();homes++;});
  key('k',{ctrlKey:true});assert.equal(shadow.querySelector('[role=option] .label').textContent,'Home','Home leads the list');
  query('home');assert.equal(shadow.querySelector('[role=option] .label').textContent,'Home');assert.equal(shadow.querySelector('[role=option] .icon').textContent,'↗');
  key('Enter',{},shadow.querySelector('.search input'));assert.equal(homes,1);assert.equal(shadow.querySelector('dialog').open,false);
  dom.window.close();
  const signedOut=setup({signedIn:false});signedOut.key('k',{ctrlKey:true});signedOut.query('home');
  assert.ok(![...signedOut.shadow.querySelectorAll('[role=option] .label')].some(label=>label.textContent==='Home'));signedOut.dom.window.close();
});
test('an open VTOP mega-menu closes on Escape or a click outside it, but not on clicks inside it', () => {
  const {dom,w}=setup({platform:'Win32'});const d=w.document;
  const box=d.querySelector('#MG0002');box.hidden=false;box.classList.add('collapse');
  const toggle=d.createElement('a');toggle.className='hmenuItem';toggle.dataset.bsToggle='collapse';toggle.setAttribute('aria-controls','MG0002');d.querySelector('nav').prepend(toggle);
  let toggles=0;toggle.addEventListener('click',()=>{toggles++;box.classList.toggle('show');});
  const click=target=>target.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));
  box.classList.add('show');click(box.querySelector('a'));assert.equal(box.classList.contains('show'),true,'inside click keeps it open');
  click(d.querySelector('main h1'));assert.equal(box.classList.contains('show'),false);assert.equal(toggles,1);
  box.classList.add('show');d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(box.classList.contains('show'),false);
  click(toggle);assert.equal(box.classList.contains('show'),true,'its own toggle still opens it');assert.equal(toggles,3);
  click(d.querySelector('main h1'));assert.equal(toggles,4);click(d.querySelector('main h1'));assert.equal(toggles,4,'nothing to close');
  dom.window.close();
});
test('automatic semester selection never touches registration, application or payment pages', async () => {
  for (const heading of ['Course Registration','Re-Exam Application','Fee Payment']) {
    const {dom,w,shadow}=setup({html:`<main id="b5-pagewrapper"><h3>${heading}</h3>${semesterHTML}</main>`,savedSemester});
    const select=w.document.querySelector('select');let changes=0;select.addEventListener('change',()=>changes++);await flush();await pause();
    assert.equal(select.value,'',heading);assert.equal(changes,0,heading);dom.window.close();
    const fresh=setup({html:`<main id="b5-pagewrapper"><h3>${heading}</h3>${semesterHTML}</main>`});await flush();
    assert.equal(fresh.shadow.querySelector('dialog').open,false,`no first-run prompt on ${heading}`);fresh.dom.window.close();
  }
  const ok=setup({html:`<main id="b5-pagewrapper"><h3>Time Table</h3>${semesterHTML}</main>`,savedSemester});await flush();
  assert.equal(ok.w.document.querySelector('select').value,savedSemester.value);ok.dom.window.close();
});

test('a default semester saved in another tab leaves this tab\'s dropdown alone until the next page', async () => {
  const {dom,w}=setup({html:semesterHTML,savedSemester}); await flush();
  const select=w.document.querySelector('select'); assert.equal(select.value,savedSemester.value);
  select.value='VL20252605'; select.dispatchEvent(new w.Event('change',{bubbles:true}));
  let changes=0; select.addEventListener('change',()=>changes++);
  for (const listener of w.storageListeners) listener({defaultSemester:{newValue:{value:'VL20252605',label:'Winter Semester 2025-26'}}},'local');
  for (const listener of w.storageListeners) listener({defaultSemester:{newValue:savedSemester}},'local');
  w.document.body.append(w.document.createElement('p')); await pause();
  assert.equal(select.value,'VL20252605'); assert.equal(changes,0);
  dom.window.close();
});
