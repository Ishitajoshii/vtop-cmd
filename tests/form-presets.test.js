const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const source = fs.readFileSync(__dirname + '/../form-presets.js','utf8');
const html = `<main id="b5-pagewrapper"><h2>Sample request</h2><form id="request"><label>Purpose<textarea name="purpose"></textarea></label><label>Category<select name="category"><option value="">Choose</option><option value="study">Study</option></select></label><label><input type="checkbox" name="notify">Notify me</label><input type="hidden" name="csrf" value="secret"><input name="captcha"><input type="file" name="attachment"><button type="submit">Submit</button></form></main>`;
const pause = () => new Promise(resolve=>setTimeout(resolve,220));
async function setup(markup=html, saved={}) {
 const dom = new JSDOM(markup,{runScripts:'outside-only',url:'https://vtop.vit.ac.in/vtop/content'}), w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 const store=structuredClone(saved); let fail=false;
 w.chrome={storage:{local:{get:async()=>store,set:async value=>{if(fail) throw Error('storage unavailable');Object.assign(store,structuredClone(value));}}}};
 for(const file of ['brand.js','combobox.js','search-select.js'])w.eval(fs.readFileSync(__dirname+'/../'+file,'utf8'));w.eval(source);await pause();
 return {dom,w,store,fail:()=>{fail=true;},ui:w.document.querySelector('#vtop-form-presets').shadowRoot,open:()=>w.document.querySelector('.vtop-form-preset-bar').shadowRoot.querySelector('button').click()};
}
test('editor is independent, saves local values, restores on replacement, and never submits',async()=>{
 const {dom,w,ui,open,store}=await setup();let submits=0;w.document.addEventListener('submit',e=>{e.preventDefault();submits++;});
 open();assert.equal(ui.querySelector('dialog').open,true);assert.equal(ui.querySelectorAll('.fields input:not([type=search]),.fields textarea,.fields select').length,3);
 ui.querySelector('textarea').value='Quiet study';ui.querySelector('select').value='study';ui.querySelector('.fields input[type=checkbox]').checked=true;
 assert.equal(w.document.querySelector('textarea').value,'');
 ui.querySelector('.save').click();await pause();assert.equal(w.document.querySelector('textarea').value,'Quiet study');assert.equal(w.document.querySelector('select').value,'study');assert.equal(w.document.querySelector('[name=notify]').checked,true);
 assert.ok(!JSON.stringify(store).includes('secret'));assert.ok(!JSON.stringify(store).includes('captcha'));
 w.document.querySelector('main').outerHTML=html;await pause();assert.equal(w.document.querySelector('textarea').value,'Quiet study');assert.equal(w.document.querySelectorAll('.vtop-form-preset-bar').length,1);assert.equal(submits,0);dom.window.close();
});
test('disabled presets survive reload, remain editable, and do not fill; cancel does not save',async()=>{
 const one=await setup();one.open();one.ui.querySelector('textarea').value='Saved draft';one.ui.querySelector('.enabled').checked=false;one.ui.querySelector('.save').click();await pause();assert.equal(one.w.document.querySelector('textarea').value,'');
 const two=await setup(html,one.store);two.open();assert.equal(two.ui.querySelector('textarea').value,'Saved draft');assert.equal(two.ui.querySelector('.enabled').checked,false);
 two.ui.querySelector('textarea').value='Discard me';two.ui.querySelector('.cancel').click();two.open();assert.equal(two.ui.querySelector('textarea').value,'Saved draft');
 two.ui.querySelector('.enabled').checked=true;two.ui.querySelector('.save').click();await pause();assert.equal(two.w.document.querySelector('textarea').value,'Saved draft');one.dom.window.close();two.dom.window.close();
});
test('a click on the editor backdrop closes it without saving',async()=>{
 const s=await setup();s.open();const dialog=s.ui.querySelector('dialog');dialog.getBoundingClientRect=()=>({left:20,right:640,top:20,bottom:600});
 s.ui.querySelector('textarea').value='Not saved';dialog.dispatchEvent(new s.w.MouseEvent('click',{bubbles:true,clientX:300,clientY:300}));assert.equal(dialog.open,true);
 dialog.dispatchEvent(new s.w.MouseEvent('click',{bubbles:true,clientX:700,clientY:300}));assert.equal(dialog.open,false);assert.equal(s.store.formPresets,undefined);s.dom.window.close();
});
test('page and form identities isolate presets, including newly discovered forms',async()=>{
 const s=await setup();s.open();s.ui.querySelector('textarea').value='Only on this page';s.ui.querySelector('.save').click();await pause();
 s.w.document.querySelector('h2').textContent='Different request';s.w.document.querySelector('textarea').value='';await pause();assert.equal(s.w.document.querySelector('textarea').value,'');
 s.w.document.querySelector('main').insertAdjacentHTML('beforeend','<form id="other"><label>Notes<input name="notes"></label></form>');await pause();assert.equal(s.w.document.querySelectorAll('.vtop-form-preset-bar').length,2);s.dom.window.close();
});
test('missing dependent options retry when options arrive, while unchanged options preserve manual edits',async()=>{
 const s=await setup();s.open();s.ui.querySelector('select').value='study';s.ui.querySelector('.save').click();await pause();
 s.w.document.querySelector('main').outerHTML=html.replace('<option value="study">Study</option>','');await pause();assert.equal(s.w.document.querySelector('select').value,'');
 s.w.document.querySelector('select').insertAdjacentHTML('beforeend','<option value="study">Study</option>');await pause();assert.equal(s.w.document.querySelector('select').value,'study');
 s.w.document.querySelector('select').value='';s.w.document.querySelector('main').append(s.w.document.createElement('div'));await pause();assert.equal(s.w.document.querySelector('select').value,'');s.dom.window.close();
});
test('login forms are excluded; delete removes persisted preset; storage errors keep editor open',async()=>{
 const login=await setup('<main id="b5-pagewrapper"><form><input name="username"><input type="password"></form></main>');assert.equal(login.w.document.querySelector('.vtop-form-preset-bar'),null);login.dom.window.close();
 const s=await setup();s.open();s.ui.querySelector('.save').click();await pause();s.open();s.ui.querySelector('.delete').click();await pause();assert.equal(Object.keys(s.store.formPresets).length,0);
 s.open();s.fail();s.ui.querySelector('.save').click();await pause();assert.equal(s.ui.querySelector('dialog').open,true);assert.match(s.ui.querySelector('.status').textContent,/Could not save/);s.dom.window.close();
});
test('multiple selects and radio groups keep their values; unavailable saved choices remain editable',async()=>{
 const markup='<main id="b5-pagewrapper"><h2>Options</h2><form id="options"><label><input type="radio" name="mode" value="a" checked>A</label><label><input type="radio" name="mode" value="b">B</label><label>Days<select name="days" multiple><option value="mon">Monday</option><option value="tue">Tuesday</option></select></label></form></main>';
 const s=await setup(markup);s.open();const radios=s.ui.querySelectorAll('[type=radio]');radios[1].click();s.ui.querySelector('select').options[1].selected=true;s.ui.querySelector('.save').click();await pause();assert.equal(s.w.document.querySelector('[value=a]').checked,false);assert.equal(s.w.document.querySelector('[value=b]').checked,true);assert.equal(s.w.document.querySelector('select').value,'tue');
 s.w.document.querySelector('select').querySelector('[value=tue]').remove();await pause();s.open();assert.equal(s.ui.querySelector('select').value,'tue');s.ui.querySelector('.save').click();await pause();s.w.document.querySelector('select').insertAdjacentHTML('beforeend','<option value="tue">Tuesday</option>');await pause();assert.equal(s.w.document.querySelector('select').value,'tue');s.dom.window.close();
});
test('preset semester values take precedence over the default semester',async()=>{
 const markup='<main id="b5-pagewrapper"><h2>Time Table</h2><form id="query"><select id="semesterSubId"><option value="fall">Fall Semester 2026-27</option><option value="winter">Winter Semester 2026-27</option></select><select id="courseId"><option value="c1">Course 1</option><option value="c2">Course 2</option></select></form></main>';
 const s=await setup(markup);s.open();const selects=s.ui.querySelectorAll('select');selects[0].value='winter';selects[1].value='c2';s.ui.querySelector('.save').click();await pause();
 const w=s.w;w.chrome.storage.local.get=async()=>({...s.store,defaultSemester:{value:'fall',label:'Fall Semester 2026-27'}});
 for(const file of ['brand.js','combobox.js','navigation.js','semesters.js','enhancements.js','content.js'])w.eval(fs.readFileSync(__dirname+'/../'+file,'utf8'));
 await pause();assert.equal(w.document.querySelector('#semesterSubId').value,'winter');assert.equal(w.document.querySelector('#courseId').value,'c2');s.dom.window.close();
});

test('modern content wrapper takes priority over an empty legacy wrapper earlier in the document',async()=>{
 const s=await setup('<div id="page-wrapper"></div>'+html);assert.equal(s.w.document.querySelectorAll('.vtop-form-preset-bar').length,1);s.open();assert.equal(s.ui.querySelectorAll('.fields textarea').length,1);s.dom.window.close();
});
test('launcher sits beside primary page actions and tracks CSS and ancestor visibility',async()=>{
 const markup='<main id="b5-pagewrapper"><h2>Leave</h2><form class="row" id="actions"><div class="col-auto"><button type="button" data-effectdivision="DataBlock">Leave Request</button></div><div class="col-auto"><button type="button" data-effectdivision="DataBlock">History</button></div></form><div id="DataBlock"><div id="panel"><form id="leave"><label>Reason<textarea name="reason"></textarea></label><button type="submit">Submit</button></form></div></div></main>';
 const s=await setup(markup), d=s.w.document, bar=d.querySelector('.vtop-form-preset-bar');
 assert.equal(bar.parentElement.id,'actions');assert.equal(bar.previousElementSibling.textContent,'History');assert.equal(bar.hidden,false);
 d.querySelector('#panel').style.display='none';await pause();assert.equal(bar.hidden,true);
 d.querySelector('#panel').style.display='';await pause();assert.equal(bar.hidden,false);
 s.open();assert.equal(s.ui.querySelector('dialog').open,true);d.querySelector('#DataBlock').setAttribute('aria-hidden','true');await pause();assert.equal(bar.hidden,true);assert.equal(s.ui.querySelector('dialog').open,false);
 d.querySelector('#DataBlock').removeAttribute('aria-hidden');await pause();assert.equal(bar.hidden,false);
 d.querySelector('#leave').remove();await pause();assert.equal(bar.isConnected,false);s.dom.window.close();
});
test('preset UI tracks Cmd+K theme in both directions, including newly inserted launchers',async()=>{
 const s=await setup(),d=s.w.document,host=d.querySelector('#vtop-form-presets');
 assert.equal(host.hasAttribute('data-dark'),false);d.documentElement.setAttribute('data-vtop-command-dark','');await pause();assert.equal(host.hasAttribute('data-dark'),true);assert.equal(d.querySelector('.vtop-form-preset-bar').hasAttribute('data-dark'),true);
 d.querySelector('main').insertAdjacentHTML('beforeend','<form id="second"><input name="text"></form>');await pause();assert.equal([...d.querySelectorAll('.vtop-form-preset-bar')].every(bar=>bar.hasAttribute('data-dark')),true);
 d.documentElement.removeAttribute('data-vtop-command-dark');await pause();assert.equal(host.hasAttribute('data-dark'),false);assert.equal([...d.querySelectorAll('.vtop-form-preset-bar')].some(bar=>bar.hasAttribute('data-dark')),false);s.dom.window.close();
});
test('multiple form launchers sharing a toolbar settle without repeated DOM mutations',async()=>{
 const markup='<main id="b5-pagewrapper"><h2>Requests</h2><div><button data-effectdivision="DataBlock">Request</button></div><div id="DataBlock"><form id="one"><input name="a"></form><form id="two"><input name="b"></form></div></main>';
 const s=await setup(markup);let mutations=0;const observer=new s.w.MutationObserver(records=>{mutations+=records.length;});observer.observe(s.w.document.body,{subtree:true,childList:true,attributes:true});await pause();await pause();assert.equal(mutations,0);observer.disconnect();s.dom.window.close();
});
const linked=`<main id="b5-pagewrapper"><h2>Late Hour Permission</h2><form id="LateHourRequestForm"><label>School<select id="costCentreId" name="costCentreId" data-isprimarycontrol="true" data-effectdivision="FacultyBlock"><option value="">Select</option><option value="a">School A</option><option value="b">School B</option></select></label><div id="FacultyBlock"><label>Faculty<select id="appliedTo" name="appliedTo"><option value="">Select</option></select></label></div><label>Venue Type<select id="roomTypeId" name="roomTypeId" data-isprimarycontrol="true" data-effectdivision="AcademicBlock"><option value="">Select</option><option value="lab">Laboratory</option></select></label><div id="AcademicBlock"><label>Block<select disabled id="buildingId" name="buildingId" data-isprimarycontrol="true" data-effectdivision="AcademicBlock"><option value="">Select</option></select></label><label>Venue<select disabled id="venue" name="venue"><option value="">Select</option></select></label></div><label>Work<select id="lateHourEventId" name="lateHourEventId" data-effectdivision="DateBlock"><option value="">Select</option><option value="project">Project</option></select></label><div id="DateBlock"><label>From<input type="date" id="lateHourFromDate" name="lateHourFromDate"></label><label>From time<select id="fromTime" name="fromTime"><option value="">Select</option></select></label><label>To<input type="date" id="lateHourToDate" name="lateHourToDate"></label><label>To time<select id="toTime" name="toTime"><option value="">Select</option></select></label></div><textarea name="details"></textarea><button type="submit">Submit Request</button></form></main>`;
function linkedActions(s){const calls=[];let fail=false;s.w.VtopPageActions={change:async(source,value)=>{calls.push([source.id,value]);source.value=value;await new Promise(r=>setTimeout(r,60));if(fail){fail=false;return false;}const d=s.w.document;if(source.id==='costCentreId')d.querySelector('#appliedTo').innerHTML=`<option value="">Select</option><option value="${value}1">Faculty ${value} one</option>`;if(source.id==='roomTypeId')d.querySelector('#AcademicBlock').innerHTML='<select id="buildingId" name="buildingId" data-effectdivision="AcademicBlock"><option value="">Select</option><option value="block">Block One</option></select><select disabled id="venue" name="venue"><option value="">Select</option></select>';if(source.id==='buildingId'){d.querySelector('#venue').disabled=false;d.querySelector('#venue').innerHTML='<option value="">Select</option><option value="room">Room One</option>'; }if(source.id==='lateHourEventId'){d.querySelector('#fromTime').innerHTML='<option value="">Select</option><option value="18:00">18:00</option>';d.querySelector('#toTime').innerHTML='<option value="">Select</option><option value="20:00">20:00</option>';}return true;}};return{calls,fail:()=>{fail=true;}};}
function copy(s,id){return [...s.ui.querySelectorAll('.fields select,.fields input:not([type=search])')].find(field=>field.getAttribute('aria-label')===id)||s.ui.querySelector(`.fields [aria-label="${id}"]`);}
function choose(s,name,value){const select=[...s.ui.querySelectorAll('.fields select')].find(f=>f.getAttribute('aria-label')===name);assert.ok(select,name);select.value=value;select.dispatchEvent(new s.w.Event('change',{bubbles:true}));return select;}
test('school/faculty, venue/block/room, and work/time chains load inside a fresh preset',async()=>{const s=await setup(linked),actions=linkedActions(s);let submits=0;s.w.document.addEventListener('submit',()=>submits++);s.open();assert.equal(copy(s,'Block').disabled,true);choose(s,'School','a');assert.equal(s.ui.querySelector('.save').disabled,true);await pause();assert.equal(copy(s,'Faculty').options.length,2);choose(s,'Faculty','a1');choose(s,'Venue Type','lab');await pause();assert.equal(copy(s,'Block').disabled,false);choose(s,'Block','block');await pause();assert.equal(copy(s,'Venue').disabled,false);choose(s,'Venue','room');choose(s,'Work','project');await pause();assert.equal(copy(s,'From time').options.length,2);assert.equal(copy(s,'To time').options.length,2);choose(s,'From time','18:00');choose(s,'To time','20:00');await pause();s.ui.querySelector('.save').click();await pause();assert.equal(submits,0);const values=Object.values(s.store.formPresets)[0].values;assert.ok(Object.values(values).includes('a1'));assert.ok(Object.values(values).includes('room'));assert.ok(actions.calls.some(([id])=>id==='costCentreId'));s.dom.window.close();});
test('rapid parent changes discard stale faculty and cancel stops queued lookups without saving',async()=>{const s=await setup(linked),actions=linkedActions(s);s.open();choose(s,'School','a');choose(s,'School','b');await pause();assert.equal(copy(s,'School').value,'b');assert.equal(copy(s,'Faculty').options[1].value,'b1');choose(s,'Faculty','b1');choose(s,'School','a');await pause();assert.equal(copy(s,'Faculty').value,'');assert.ok(![...copy(s,'Faculty').options].some(o=>o.value==='b1'));choose(s,'School','b');s.ui.querySelector('.cancel').click();await pause();assert.equal(s.store.formPresets,undefined);assert.equal(s.ui.querySelector('dialog').open,false);assert.ok(actions.calls.length>=3);s.dom.window.close();});
test('lookup failure reports an error, allows retry, and native dropdowns are searchable too',async()=>{const s=await setup(linked),actions=linkedActions(s);assert.equal(s.w.document.querySelectorAll('.vtop-search-select').length,8);s.open();actions.fail();choose(s,'School','a');await pause();assert.match(s.ui.querySelector('.status').textContent,/Could not load/);assert.equal(s.ui.querySelector('.save').disabled,false);choose(s,'School','b');await pause();assert.equal(copy(s,'Faculty').options[1].value,'b1');assert.equal(s.ui.querySelector('.status').textContent,'');s.dom.window.close();});
test('reopening a disabled saved preset hydrates all unloaded dependencies in order without losing saved children',async()=>{
 const first=await setup(linked);linkedActions(first);first.open();choose(first,'School','a');await pause();choose(first,'Faculty','a1');choose(first,'Venue Type','lab');await pause();choose(first,'Block','block');await pause();choose(first,'Venue','room');choose(first,'Work','project');await pause();choose(first,'From time','18:00');choose(first,'To time','20:00');await pause();first.ui.querySelector('.enabled').checked=false;first.ui.querySelector('.save').click();await pause();
 const second=await setup(linked,first.store);linkedActions(second);second.open();await new Promise(r=>setTimeout(r,800));assert.equal(copy(second,'School').value,'a');assert.equal(copy(second,'Faculty').value,'a1');assert.equal(copy(second,'Block').value,'block');assert.equal(copy(second,'Venue').value,'room');assert.equal(copy(second,'From time').value,'18:00');assert.equal(copy(second,'To time').value,'20:00');assert.equal(second.ui.querySelector('.enabled').checked,false);first.dom.window.close();second.dom.window.close();
});
test('reopening an enabled preset on an already-filled page keeps the saved venue through repeated lookups',async()=>{
 const first=await setup(linked);linkedActions(first);first.open();choose(first,'School','a');await pause();choose(first,'Faculty','a1');choose(first,'Venue Type','lab');await pause();choose(first,'Block','block');await pause();choose(first,'Venue','room');first.ui.querySelector('.save').click();await pause();
 // The page already shows the saved block and venue, as after auto-fill; reopening reruns School and Venue Type lookups that reload the venue list.
 const filled=linked.replace('<select disabled id="buildingId"','<select id="buildingId"').replace('<option value="">Select</option></select></label><label>Venue','<option value="">Select</option><option value="block" selected>Block One</option></select></label><label>Venue').replace('<select disabled id="venue" name="venue"><option value="">Select</option></select>','<select id="venue" name="venue"><option value="">Select</option><option value="room" selected>Room One</option></select>');
 const second=await setup(filled,first.store);linkedActions(second);second.open();await new Promise(r=>setTimeout(r,900));
 assert.equal(copy(second,'Block').value,'block');assert.equal(copy(second,'Venue').value,'room');first.dom.window.close();second.dom.window.close();
});
test('resetting a field leaves it out of the preset and reopens it as Not filled',async()=>{
 const s=await setup();s.open();s.ui.querySelector('textarea').value='Quiet study';s.ui.querySelector('textarea').dispatchEvent(new s.w.Event('input'));choose(s,'Category','study');
 assert.match(s.ui.querySelector('.field-count').textContent,/^3 SAVED FIELDS/);
 s.ui.querySelector('[aria-label="Reset Category"]').click();assert.equal(s.ui.querySelector('.fields select').value,'');assert.match(s.ui.querySelector('.field-count').textContent,/^2 SAVED FIELDS/);
 s.ui.querySelector('.save').click();await pause();
 const values=Object.values(s.store.formPresets)[0].values;assert.ok(Object.values(values).includes('Quiet study'));assert.ok(!Object.keys(values).some(key=>key.includes('category')));
 s.w.document.querySelector('select').value='study';s.open();
 const head=s.ui.querySelector('[aria-label="Reset Category"]').parentElement;assert.equal(s.ui.querySelector('.fields select').value,'','reset field starts empty, not from the page');
 assert.equal(head.querySelector('.reset').hidden,true);assert.equal(head.querySelector('.unset').hidden,false);
 choose(s,'Category','study');assert.equal(head.querySelector('.unset').hidden,true);s.dom.window.close();
});
test('resetting a lookup parent empties its dependents without asking VTOP',async()=>{
 const s=await setup(linked),actions=linkedActions(s);s.open();choose(s,'School','a');await pause();choose(s,'Faculty','a1');
 const before=actions.calls.length;s.ui.querySelector('[aria-label="Reset School"]').click();await pause();
 assert.equal(actions.calls.length,before,'no lookup for a reset');assert.equal(copy(s,'School').value,'');assert.equal(copy(s,'Faculty').value,'');
 s.ui.querySelector('.save').click();await pause();const values=Object.values(s.store.formPresets)[0].values;
 assert.ok(!Object.keys(values).some(key=>/costCentreId|appliedTo/.test(key)));s.dom.window.close();
});
test('a redraw that keeps your different choice is not overwritten by the preset; a blank redraw is filled again',async()=>{
 const markup='<main id="b5-pagewrapper"><h2>Digital Assignment</h2><form id="da"><div id="block"><select id="semesterSubId" name="semesterSubId"><option value="">Choose</option><option value="fall">Fall</option><option value="winter">Winter</option></select></div></form></main>';
 const s=await setup(markup);s.open();choose(s,'semesterSubId','fall');s.ui.querySelector('.save').click();await pause();
 const d=s.w.document;assert.equal(d.querySelector('#semesterSubId').value,'fall');
 // You pick Winter; VTOP redraws the block with Winter still selected.
 d.querySelector('#block').innerHTML='<select id="semesterSubId" name="semesterSubId"><option value="">Choose</option><option value="fall">Fall</option><option value="winter" selected>Winter</option></select>';await pause();await pause();
 assert.equal(d.querySelector('#semesterSubId').value,'winter','your choice stays');
 // A fresh, empty redraw is filled again.
 d.querySelector('#block').innerHTML='<select id="semesterSubId" name="semesterSubId"><option value="">Choose</option><option value="fall">Fall</option><option value="winter">Winter</option></select>';await pause();await pause();
 assert.equal(d.querySelector('#semesterSubId').value,'fall');s.dom.window.close();
});
test('unrelated page changes do not rebuild the editor\'s dropdown lists',async()=>{
 const s=await setup(linked);linkedActions(s);s.open();choose(s,'School','a');await pause();
 const first=copy(s,'Faculty').options[1];assert.ok(first);
 s.w.document.querySelector('main').append(s.w.document.createElement('span'));s.w.document.querySelector('main').className='busy';await pause();await pause();
 assert.equal(copy(s,'Faculty').options[1],first,'same option node: the list was not rebuilt');s.dom.window.close();
});
