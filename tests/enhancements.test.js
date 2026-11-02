const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const api=require('../enhancements');
const root=__dirname+'/../';
const semester='<select id="semesterSubId"><option value="S1">Fall Semester 2026-27</option></select>';
const course='<select id="courseId"><option value="">Choose course</option><option value="C1">Course A</option><option value="C2">Course B</option></select>';
function setup(html,settings={},fetch,session){
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://vtop.vit.ac.in/vtop/content'}),w=dom.window,writes=[];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.chrome={storage:{local:{get:async()=>({defaultSemester:null,...settings}),set:async v=>writes.push(JSON.parse(JSON.stringify(v)))},onChanged:{addListener(){}},
  ...(session?{session:{get:async()=>JSON.parse(JSON.stringify(session.data)),set:async v=>{Object.assign(session.data,JSON.parse(JSON.stringify(v)));session.writes.push(JSON.parse(JSON.stringify(v)));}}}:{})}};
 if(fetch)w.fetch=fetch;
 for(const file of ['brand.js','combobox.js','navigation.js','semesters.js','enhancements.js','content.js','page-enhancements.js'])w.eval(fs.readFileSync(root+file,'utf8'));
 return{dom,w,writes,shadow:w.document.querySelector('#vtop-command-root').shadowRoot};
}
const pause=()=>new Promise(r=>setTimeout(r,200));
test('attendance boundaries use exact counts, editable targets and conservative rounding',()=>{
 assert.equal(api.attendance(30,40).missable,0);
 assert.equal(api.attendance(29,40).needed,4);
 assert.equal(api.attendance(40,40).missable,13);
 assert.equal(api.attendance(39,40,100).needed,Infinity);
 assert.equal(api.attendance(40,40,100).missable,0);
 assert.equal(api.attendance(8,10,80).needed,0);
 for(const values of [[5,4,75],[-1,5,75],[1.5,5,75],[1,5,0],[1,5,101],[NaN,5,75]])assert.equal(api.attendance(...values),null);
 assert.equal(api.attendance(0,0).percentage,null);
});
test('attendance DOM reader handles observed VTOP headers and ignores percentage-only or malformed rows',()=>{
 const dom=new JSDOM('<table><tr><td>Course Detail</td><td>Attended Classes/Days</td><td>Total Classes</td><td>Attendance Percentage</td></tr><tr><td>Sample A</td><td>29</td><td>40</td><td>73%</td></tr><tr><td>Bad</td><td>--</td><td>40</td><td>--</td></tr></table>');
 assert.deepEqual(api.attendanceRows(dom.window.document),[{label:'Sample A',attended:29,total:40}]);dom.window.close();
});
test('deadline parser uses IST, supports explicit dates/times, validates dates and marks date-only estimates',()=>{
 assert.equal(api.parseDeadline('03-Nov-2026 11:59 PM').time,Date.parse('2026-11-03T23:59:00+05:30'));
 assert.equal(api.parseDeadline('2026-11-03T18:30').time,Date.parse('2026-11-03T18:30:00+05:30'));
 assert.equal(api.parseDeadline('03/11/2026').time,Date.parse('2026-11-03T23:59:59+05:30'));
 assert.equal(api.parseDeadline('03-Nov-2026').dateOnly,true);
 for(const date of ['31-Feb-2026','2026-13-01','03-Nov-2026 25:00','03-Nov-2026 00:30 PM','not a date'])assert.equal(api.parseDeadline(date),null,date);
});
test('next due excludes submitted assignments, includes not uploaded, sorts deadlines and tracks overdue',()=>{
 const dom=new JSDOM('<table><tr><th>Course Name</th><th>Title</th><th>Last Date</th><th>Uploaded</th></tr><tr><td>A</td><td>DA1</td><td>04-Nov-2026 18:00</td><td>No</td></tr><tr><td>B</td><td>DA2</td><td>03-Nov-2026 18:00</td><td>Not Uploaded</td></tr><tr><td>C</td><td>DA3</td><td>02-Nov-2026 18:00</td><td>Yes</td></tr><tr><td>D</td><td>DA4</td><td>01-Nov-2026 18:00</td><td>Pending</td></tr></table>');
 const result=api.dueSummary(api.assignmentRows(dom.window.document),Date.parse('2026-11-02T18:00:00+05:30'));
 assert.equal(result.next.label,'B · DA2');assert.equal(result.overdue,1);assert.equal(result.pending.length,3);
 assert.equal(api.countdown(result.next.time,Date.parse('2026-11-02T18:00:00+05:30')),'Due in 1d 0h 0m');dom.window.close();
});
test('semester chip is visible and attendance calculates per table row without storing grades',async()=>{
 const {dom,w,shadow,writes}=setup('<main id="b5-pagewrapper"><h1>Attendance</h1><table><tr><th>Course Detail</th><th>Attended Classes/Days</th><th>Total Classes</th></tr><tr><td>Sample A</td><td>29</td><td>40</td></tr></table></main>',{defaultSemester:{value:'S1',label:'Fall Semester 2026-27'}});
 await pause();assert.equal(shadow.querySelector('.semester-chip').textContent,'Fall 2026-27');
 const row= w.document.querySelector('.vtop-row-attendance').shadowRoot;
 assert.match(row.querySelector('p').textContent,/Attend 4 more classes/);
 assert.equal(row.querySelector('input'),null);assert.match(row.textContent,/Target: 75%/);
 assert.equal(shadow.querySelector('.tools-launcher'),null);assert.equal(shadow.querySelector('.tools-dialog'),null);
 assert.equal(writes.length,0);dom.window.close();
});
const dashboardHTML=(rows)=>`<table class="customTable"><tbody><tr class="fixedContent tableHeader"><td>Semester</td><td>Course Code</td><td>Course Title</td></tr><tr class="fixedContent tableContent"><td>Fall Semester 2026-27</td><td>X</td><td>Y</td></tr></tbody></table>
<table class="customTable"><tbody><tr class="fixedContent tableHeader"><td rowspan="2">Sl.No.</td><td rowspan="2">Title</td><td rowspan="2">Max. Mark</td><td rowspan="2">Weightage %</td><td rowspan="2">Due Date</td><td rowspan="2">QP</td><td colspan="3">Document Details</td></tr>
<tr class="fixedContent tableHeader"><td>Last Updated On</td><td>Upload/Edit</td><td>Download</td></tr></tbody><tbody>${rows.map(([title,due,updated],i)=>`<tr class="fixedContent tableContent"><td>${i+1}</td><td>${title}</td><td>20</td><td>20</td><td><span style="color:red">${due}</span></td><td><button id="downloadQuestion" class="bi bi-download"></button></td><td><span>${updated}</span></td><td></td><td></td></tr>`).join('')}</tbody></table>`;
const courseList=ids=>`<main id="b5-pagewrapper"><form id="digitalAssignment"><input type="hidden" id="authorizedID" value="TEST-ID"><input type="hidden" name="_csrf" value="test-csrf"></form><table class="customTable"><tbody><tr class="tableHeader"><td>Sl.No</td><td>Class Nbr</td><td>Course Code</td><td>Course Title</td><td>Course Type</td><td>Faculty Name</td><td>Dashboard</td></tr>
${ids.map((id,i)=>`<tr class="tableContent"><td>${i+1}</td><td>${id}</td><td>CODE${i}</td><td>Course ${i}</td><td>TH</td><td>Faculty</td><td><button type="button" class="btn btn-link" onclick="javascript:myFunction('${id}');"><span class="bi bi-folder-symlink-fill"></span></button></td></tr>`).join('')}</tbody></table></main>`;
test('assignment dashboard with a two-row header yields deadlines and upload status',()=>{
 const dom=new JSDOM(dashboardHTML([['Case Study - I','24-Oct-2099',''],['Lab record','01-Jan-2020','21 Oct 2026 10:18 PM']]));
 const records=api.assignmentRows(dom.window.document);
 assert.deepEqual(records.map(r=>[r.title,r.submitted,r.statusKnown]),[['Case Study - I',false,true],['Lab record',true,true]]);
 assert.equal(records[0].dueCell.textContent.trim(),'24-Oct-2099');
 assert.equal(api.dueState(records[1]).text,'Submitted');assert.equal(api.dueState(records[0],Date.parse('2099-10-23T00:00:00+05:30')).tone,'soon');
 assert.equal(api.dueState({time:0,submitted:false}).tone,'overdue');
 const now=Date.parse('2026-11-02T12:00:00+05:30');
 assert.equal(api.dueState({time:now+(45*3600+59*60)*1000},now).text,'Due in 1d 21h');assert.equal(api.dueState({time:now+90*60000},now).text,'Due in 1h 30m');
 assert.equal(api.dueState({time:now-9.5*86400000},now).text,'Overdue by 9d');assert.equal(api.dueState({time:now-5*60000},now).text,'Overdue by 5m');dom.window.close();
});
test('Digital Assignment course list shows each course\'s pending deadlines beside its title, one read-only request at a time',async()=>{
 const calls=[];let active=0,maxActive=0;
 const responses={A1:[['Case Study - I','24-Oct-2099',''],['Quiz','01-Jan-2020',''],['Lab record','01-Dec-2099','02 Nov 2026 09:00 AM']],B2:[['Report','10-Nov-2099','02 Nov 2026 09:00 AM']],C3:[]};
 const {dom,w,writes}=setup(courseList(['A1','B2','C3']),{},async(url,init)=>{calls.push({url:String(url),init});active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,10));active--;
  return{ok:true,text:async()=>dashboardHTML(responses[init.body.get('classId')])};});
 await pause();await pause();
 assert.deepEqual(calls.map(c=>c.init.body.get('classId')),['A1','B2','C3']);assert.equal(maxActive,1);
 assert.equal(calls[0].url,'https://vtop.vit.ac.in/vtop/examinations/processDigitalAssignment');assert.equal(calls[0].init.method,'POST');
 assert.equal(calls[0].init.body.get('_csrf'),'test-csrf');assert.equal(calls[0].init.body.get('authorizedID'),'TEST-ID');
 const badges=[...w.document.querySelectorAll('.vtop-course-deadlines')].map(host=>host.shadowRoot.querySelector('ul').textContent.replace(/\s+/g,' '));
 assert.equal(badges.length,3);
 const chips=[...w.document.querySelector('.vtop-course-deadlines').shadowRoot.querySelectorAll('.chip')];
 assert.deepEqual(chips.map(chip=>chip.textContent),['1 Jan','24 Oct'],'uniform date-only chips, earliest first');
 assert.match(chips[0].dataset.tip,/^Quiz · Overdue by/);assert.match(chips[1].dataset.tip,/^Case Study - I · Due in/);
 assert.deepEqual(chips.map(chip=>chip.className),['chip overdue','chip pending']);assert.equal(chips[0].tabIndex,0);
 assert.ok(!badges[0].includes('Lab record')&&!chips.some(chip=>chip.dataset.tip.includes('Lab record')),'submitted work is hidden');
 assert.equal(badges[1].trim(),'—');assert.equal(badges[2].trim(),'—');
 const table=w.document.querySelector('table'),header=[...table.rows[0].cells].map(cell=>cell.textContent.trim());
 assert.deepEqual(header.slice(-3),['Faculty Name','Pending','Dashboard'],'own column just before Dashboard');
 const host=w.document.querySelector('.vtop-course-deadlines');assert.equal(host.parentElement.className,'vtop-deadline-col');assert.equal(host.parentElement.cellIndex,6);
 assert.equal(table.rows[1].cells[3].textContent.trim(),'Course 0','Course Title cell untouched');assert.equal(table.rows[1].cells.length,table.rows[0].cells.length);
 w.document.body.append(w.document.createElement('p'));await pause();assert.equal(calls.length,3,'cached, not refetched on DOM churn');
 assert.equal(table.querySelectorAll('.vtop-deadline-col').length,4,'one header and one cell per course, added once');
 assert.equal(writes.filter(write=>JSON.stringify(write).includes('Case Study')).length,0,'deadlines are never stored');dom.window.close();
});
test('opening a course dashboard stops background deadline requests',async()=>{
 const calls=[];let window_;
 const {dom,w}=setup(courseList(['A1','B2','C3']),{},(url,init)=>new Promise((resolve,reject)=>{calls.push(init.body.get('classId'));init.signal.addEventListener('abort',()=>{const error=new Error('aborted');error.name='AbortError';reject(error);});}));
 await pause();assert.deepEqual(calls,['A1']);
 w.document.querySelector('[onclick*="myFunction"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await pause();
 assert.deepEqual(calls,['A1']);
 // Rows that were still waiting say so, instead of showing Loading… forever.
 const states=[...w.document.querySelectorAll('.vtop-course-deadlines')].map(host=>host.shadowRoot.querySelector('ul').textContent.trim());
 assert.deepEqual(states,['Open to see','Open to see','Open to see']);dom.window.close();
});
test('course dashboard shows a countdown under each pending due date only',async()=>{
 const {dom,w}=setup(`<main id="b5-pagewrapper">${dashboardHTML([['Case Study - I','24-Oct-2099',''],['Lab record','01-Jan-2020','21 Oct 2026 10:18 PM']])}</main>`);await pause();
 const hosts=[...w.document.querySelectorAll('.vtop-due-countdown')];assert.equal(hosts.length,1);
 assert.match(hosts[0].shadowRoot.textContent,/Due in/);
 assert.equal(hosts[0].parentElement.textContent.trim(),'24-Oct-2099');dom.window.close();
});
const registeredCourses=`<main id="b5-pagewrapper"><h1>Course Page - view</h1><label for="courseId">Select Registered Course</label><select id="courseId"><option value="">-- Registered Courses --</option><option value="W1">Winter Semester 2026-27 - SAMPLE101 - Course W</option><option value="F1">Fall Semester 2026-27 - SAMPLE102 - Course F</option><option value="OLD">Fall Semester 2025-26 - SAMPLE103 - Old course</option><option value="F2">Fall Semester 2026-27 - SAMPLE104 - Course F2</option></select></main>`;
const defaultFall={value:'S1',label:'Fall Semester 2026-27'};
test('Course Page defaults to saved semester, toggles all/default with original order and nodes preserved',async()=>{
 const {dom,w}=setup(registeredCourses,{defaultSemester:defaultFall});const select=w.document.querySelector('#courseId'),original=[...select.options];await pause();
 assert.deepEqual([...select.options].map(o=>o.value),['','F1','F2']);
 const bar=w.document.querySelector('.vtop-course-scope').shadowRoot;assert.match(bar.querySelector('p').textContent,/2 courses.*Fall Semester 2026-27/);
 bar.querySelector('.all').click();assert.deepEqual([...select.options].map(o=>o.value),['','W1','F1','OLD','F2']);assert.equal(select.options[1],original[1]);
 bar.querySelector('.default').click();await pause();assert.deepEqual([...select.options].map(o=>o.value),['','F1','F2']);
 assert.equal(w.document.querySelectorAll('.vtop-course-scope').length,1);dom.window.close();
});
test('no default shows all terms; unavailable default reports empty results and lets user show all',async()=>{
 const none=setup(registeredCourses);await pause();assert.equal(none.w.document.querySelector('#courseId').options.length,5);const choose=none.w.document.querySelector('.vtop-course-scope').shadowRoot.querySelector('.default');assert.equal(choose.disabled,false);
 choose.click();const menu=none.w.document.querySelector('#vtop-command-root').shadowRoot;assert.equal(menu.querySelector('dialog').open,true);assert.equal(menu.querySelector('.semester-settings').hidden,false);none.dom.window.close();
 const missing=setup(registeredCourses,{defaultSemester:{value:'other',label:'Summer Semester 2026-27'}});await pause();
 const shadow=missing.w.document.querySelector('.vtop-course-scope').shadowRoot;assert.match(shadow.querySelector('p').textContent,/No courses for Summer/);assert.equal(missing.w.document.querySelector('#courseId').options.length,1);shadow.querySelector('.all').click();assert.equal(missing.w.document.querySelector('#courseId').options.length,5);missing.dom.window.close();
});
test('filter clears an out-of-term selection and refreshes AJAX options without reviving stale courses',async()=>{
 const {dom,w}=setup(registeredCourses.replace('value="W1"','value="W1" selected'),{defaultSemester:defaultFall});
 const select=w.document.querySelector('#courseId');let changed=0;select.addEventListener('change',()=>changed++);await pause();assert.equal(select.value,'');assert.equal(changed,1);
 select.innerHTML='<option value="">Choose course</option><option value="NEW">Fall Semester 2026-27 - NEW100 - New course</option><option value="OTHER">Winter Semester 2026-27 - NEW101 - Other course</option>';await pause();
 assert.deepEqual([...select.options].map(o=>o.value),['','NEW']);w.document.querySelector('.vtop-course-scope').shadowRoot.querySelector('.all').click();assert.deepEqual([...select.options].map(o=>o.value),['','NEW','OTHER']);dom.window.close();
});
test('attendance annotations update in place after count changes and AJAX row replacement',async()=>{
 const html='<main id="b5-pagewrapper"><table><tr><th>Course Detail</th><th>Attended Classes/Days</th><th>Total Classes</th><th>Attendance Percentage</th></tr><tr><td>A</td><td>29</td><td>40</td><td>73%</td></tr><tr><td>B</td><td>40</td><td>40</td><td>100%</td></tr></table></main>';
 const {dom,w}=setup(html);await pause();assert.equal(w.document.querySelectorAll('.vtop-row-attendance').length,2);
 const rows=w.document.querySelector('table').rows;assert.match(rows[2].querySelector('.vtop-row-attendance').shadowRoot.textContent,/Can miss 13/);
 rows[1].cells[1].textContent='30';await pause();assert.match(rows[1].querySelector('.vtop-row-attendance').shadowRoot.textContent,/Can miss 0/);assert.equal(w.document.querySelectorAll('.vtop-row-attendance').length,2);
 rows[1].outerHTML='<tr><td>C</td><td>28</td><td>40</td><td>70%</td></tr>';await pause();assert.equal(w.document.querySelectorAll('.vtop-row-attendance').length,2);assert.match(rows[1].querySelector('.vtop-row-attendance').shadowRoot.textContent,/Attend 8 more/);dom.window.close();
});
test('scope toggles keep the course you picked',async()=>{
 const {dom,w}=setup(registeredCourses,{defaultSemester:defaultFall});await pause();
 const select=w.document.querySelector('#courseId'),bar=w.document.querySelector('.vtop-course-scope').shadowRoot;
 select.value='F1';select.dispatchEvent(new w.Event('change',{bubbles:true}));
 bar.querySelector('.all').click();await pause();assert.equal(select.value,'F1','All semesters keeps the course you picked');
 bar.querySelector('.default').click();await pause();assert.equal(select.value,'F1');
 select.value='F2';select.dispatchEvent(new w.Event('change',{bubbles:true}));w.document.body.append(w.document.createElement('p'));await pause();assert.equal(select.value,'F2');dom.window.close();
});
test('semester-prefixed course labels support unnamed course controls and restore grouped options',async()=>{
 const html='<main id="b5-pagewrapper"><h1>Course Page - view</h1><select id="registeredClass"><option value="">Choose class</option><optgroup label="Fall"><option value="F">Fall Semester 2026-27 - SAMPLE101 - Fall course</option></optgroup><optgroup label="Winter"><option value="W">Winter Semester 2026-27 - SAMPLE102 - Winter course</option></optgroup></select></main>';
 const {dom,w}=setup(html,{defaultSemester:defaultFall});await pause();const select=w.document.querySelector('select');
 assert.deepEqual([...select.options].map(o=>o.value),['','F']);assert.equal(select.querySelectorAll('optgroup').length,1);
 w.document.querySelector('.vtop-course-scope').shadowRoot.querySelector('.all').click();assert.deepEqual([...select.options].map(o=>o.value),['','F','W']);assert.equal(select.querySelectorAll('optgroup').length,2);dom.window.close();
});
test('dashboards are cached in memory-only session storage for a random 1–5 hours, surviving page reloads',async()=>{
 const session={data:{},writes:[]},calls=[];
 const fetch=async(url,init)=>{calls.push(init.body.get('classId'));return{ok:true,text:async()=>dashboardHTML([['Case Study - I','24-Oct-2099','']])};};
 const before=Date.now();const first=setup(courseList(['A1','B2']),{},fetch,session);await pause();await pause();
 assert.deepEqual(calls,['A1','B2']);const saved=session.data.deadlineCache;assert.deepEqual(Object.keys(saved),['A1','B2']);
 for(const entry of Object.values(saved)){const life=entry.expires-before;assert.ok(life>=60*60000-1000&&life<=5*60*60000+1000,`lifetime ${life}`);}
 assert.equal(first.writes.filter(write=>JSON.stringify(write).includes('Case Study')).length,0,'never written to disk storage');first.dom.window.close();
 // A reload within the window reuses the cache without asking VTOP again.
 const second=setup(courseList(['A1','B2']),{},fetch,session);await pause();await pause();
 assert.deepEqual(calls,['A1','B2']);assert.match(second.w.document.querySelector('.vtop-course-deadlines').shadowRoot.querySelector('.chip').dataset.tip,/Case Study - I/);second.dom.window.close();
 // Expired entries are fetched again; others stay cached.
 session.data.deadlineCache.A1.expires=Date.now()-1;
 const third=setup(courseList(['A1','B2']),{},fetch,session);await pause();await pause();assert.deepEqual(calls,['A1','B2','A1']);third.dom.window.close();
});
test('random cache lifetimes differ between courses so refreshes do not line up',async()=>{
 const session={data:{},writes:[]},ids=['A1','B2','C3','D4','E5','F6'];
 const {dom}=setup(courseList(ids),{},async()=>({ok:true,text:async()=>dashboardHTML([])}),session);
 for(let i=0;i<6;i++)await pause();
 const expiries=Object.values(session.data.deadlineCache).map(entry=>entry.expires);
 assert.equal(expiries.length,ids.length);assert.ok(new Set(expiries.map(time=>Math.round(time/60000))).size>1);dom.window.close();
});
test('opening a dashboard refreshes that course in the cache, so a new upload shows up immediately',async()=>{
 const session={data:{deadlineCache:{VL2026270102272:{records:[{title:'Case Study - I',time:Date.parse('2099-10-24T23:59:59+05:30'),dateOnly:true,submitted:false}],expires:Date.now()+3*3600000}}},writes:[]};
 const html=`<main id="b5-pagewrapper">${dashboardHTML([['Case Study - I','24-Oct-2099','02 Nov 2026 09:00 AM']]).replace('<td>Course Title</td></tr>','<td>Course Title</td><td>Class Number</td></tr>').replace('<td>Y</td></tr>','<td>Y</td><td>VL2026270102272</td></tr>')}</main>`;
 const {dom}=setup(html,{},async()=>{throw new Error('no fetch expected');},session);await pause();
 assert.equal(session.data.deadlineCache.VL2026270102272.records[0].submitted,true);dom.window.close();
 const unchanged={data:JSON.parse(JSON.stringify(session.data)),writes:[]};
 const again=setup(html,{},async()=>{throw new Error('no fetch expected');},unchanged);await pause();assert.equal(unchanged.writes.length,0,'no rewrite when nothing changed');again.dom.window.close();
});
test('uploading a DA forgets that course\'s cached deadlines and does not re-cache the stale dashboard',async()=>{
 const id='VL2026270102272',other='VL2026270101830',expires=Date.now()+3*3600000,record=[{title:'Case Study - I',time:Date.parse('2099-10-24T23:59:59+05:30'),dateOnly:true,submitted:false}];
 const session={data:{deadlineCache:{[id]:{records:record,expires},[other]:{records:record,expires}}},writes:[]};
 const html=`<main id="b5-pagewrapper">${dashboardHTML([['Case Study - I','24-Oct-2099','']]).replace('<td>Course Title</td></tr>','<td>Course Title</td><td>Class Number</td></tr>').replace('<td>Y</td></tr>',`<td>Y</td><td>${id}</td></tr>`)}
  <form id="daUpload"><input type="hidden" name="classIdNumber" value="${id}"><input type="file" id="studDaUpload"><button type="button" id="uploadDA">Upload</button></form></main>`;
 const {dom,w}=setup(html,{},async()=>{throw new Error('no fetch expected');},session);await pause();
 w.document.querySelector('#studDaUpload').dispatchEvent(new w.Event('change',{bubbles:true}));await pause();
 assert.equal(session.data.deadlineCache[id],undefined,'uploaded course forgotten');assert.ok(session.data.deadlineCache[other],'other courses kept');
 w.document.body.append(w.document.createElement('p'));await pause();assert.equal(session.data.deadlineCache[id],undefined,'stale dashboard not re-cached');
 dom.window.close();
 const clicked={data:{deadlineCache:{[id]:{records:record,expires},[other]:{records:record,expires}}},writes:[]};
 const second=setup(html,{},async()=>{throw new Error('no fetch expected');},clicked);await pause();
 second.w.document.querySelector('#uploadDA').dispatchEvent(new second.w.MouseEvent('click',{bubbles:true}));await pause();
 assert.equal(clicked.data.deadlineCache[id],undefined,'upload button also forgets');assert.ok(clicked.data.deadlineCache[other]);second.dom.window.close();
});
test('an upload from a form with no course number releases every cached course',async()=>{
 const expires=Date.now()+3*3600000,record=[{title:'Case Study - I',time:Date.parse('2099-10-24T23:59:59+05:30'),dateOnly:true,submitted:false}];
 const session={data:{deadlineCache:{A1:{records:record,expires},B2:{records:record,expires}}},writes:[]};
 const {dom,w}=setup('<main id="b5-pagewrapper"><form id="upload"><input type="file" id="file"></form></main>',{},async()=>{throw new Error('no fetch expected');},session);await pause();
 w.document.querySelector('#file').dispatchEvent(new w.Event('change',{bubbles:true}));await pause();
 assert.deepEqual(session.data.deadlineCache,{});dom.window.close();
});
test('each marks table gets a Total row, with marks lost in its Remark cell',async()=>{
 const row=(n,title,max,weight,status,scored,weighted)=>`<tr class="tableContent-level1"><td><output>${n}</output></td><td><output>${title}</output></td><td><output>${max}</output></td><td><output>${weight}</output></td><td><output>${status}</output></td><td><output>${scored}</output></td><td><output>${weighted}</output></td><td><output></output></td></tr>`;
 const header='<tr class="tableHeader-level1"><td>Sl.No.</td><td>Mark Title</td><td>Max. Mark</td><td>Weightage %</td><td>Status</td><td>Scored Mark</td><td>Weightage Mark</td><td>Remark</td></tr>';
 const html=`<main id="b5-pagewrapper"><form id="studentMarkView"><table class="customTable"><tbody><tr class="tableContent"><td>SAMPLE101</td></tr><tr class="tableContent"><td>
  <table class="customTable-level1" id="first"><tbody>${header}${row(1,'Sample Test - I',50,15,'Present','32.0','9.6')}${row(2,'Sample Test - II',50,15,'Present','35.0','10.5')}</tbody></table></td></tr>
  <tr class="tableContent"><td><table class="customTable-level1" id="second"><tbody>${header}${row(1,'Quiz - I',10,10,'Present','8.5','8.5')}${row(2,'Quiz - II',10,10,'Absent','','')}</tbody></table></td></tr></tbody></table></form></main>`;
 const {dom,w}=setup(html);await pause();
 const totals=id=>{const rows=[...w.document.querySelector('#'+id).rows];const last=rows.at(-1);return {count:rows.filter(r=>r.classList.contains('vtop-mark-total')).length,cells:[...last.cells].map(c=>c.textContent),last:last.classList.contains('vtop-mark-total')};};
 const first=totals('first');assert.equal(first.count,1);assert.ok(first.last);assert.deepEqual(first.cells,['','Total','100','30','','67','20.1','9.9 marks lost']);
 assert.equal(w.document.querySelector('#first .vtop-mark-total .vtop-mark-lost').parentElement,w.document.querySelector('#first .vtop-mark-total').cells[7]);
 assert.deepEqual(totals('second').cells.slice(2,8),['20','20','','8.5','8.5','11.5 marks lost'],'blank marks are skipped; lost is weightage % total − weightage total');
 // A row VTOP adds later is counted, and the total stays last and single.
 w.document.querySelector('#first tbody').insertAdjacentHTML('beforeend',row(3,'Sample Quiz',10,10,'Present','9.0','9'));await pause();
 const updated=totals('first');assert.equal(updated.count,1);assert.ok(updated.last);assert.deepEqual(updated.cells.slice(2,8),['110','40','','76','29.1','10.9 marks lost']);
 // Without a Remark column the note sits beside the weightage total, and repeated scans leave it stable.
 const plain=w.document.querySelector('#second');for(const r of plain.rows)r.cells[7]?.remove();w.document.body.append(w.document.createElement('p'));await pause();await pause();
 const cell=plain.querySelector('.vtop-mark-total').cells[6];assert.equal(cell.textContent,'8.511.5 marks lost');assert.equal(cell.querySelectorAll('.vtop-mark-lost.beside').length,1);
 let changes=0;const watch=new w.MutationObserver(r=>{changes+=r.length;});watch.observe(plain,{subtree:true,childList:true,characterData:true});w.document.body.append(w.document.createElement('p'));await pause();await pause();watch.disconnect();assert.equal(changes,0);
 // The outer course table has no Mark Title column and is left alone.
 assert.equal(w.document.querySelector('.customTable').querySelectorAll(':scope > tbody > .vtop-mark-total').length,0);dom.window.close();
});
test('All semesters on Course Page survives a re-render in the same visit and resets on a new page',async()=>{
 const {dom,w}=setup(registeredCourses,{defaultSemester:defaultFall});await pause();
 w.document.querySelector('.vtop-course-scope').shadowRoot.querySelector('.all').click();
 const fresh=()=>{const html=registeredCourses.match(/<select id="courseId">[\s\S]*?<\/select>/)[0];const box=w.document.createElement('div');box.innerHTML=html;w.document.querySelector('#courseId').replaceWith(box.firstChild);};
 fresh();await pause();assert.deepEqual([...w.document.querySelector('#courseId').options].map(o=>o.value),['','W1','F1','OLD','F2'],'still all semesters after VTOP re-renders');
 const link=w.document.createElement('a');link.className='systemB5BtnMenu';link.dataset.url='academics/common/CoursePageConsolidated';link.href='#';link.addEventListener('click',e=>e.preventDefault());w.document.body.append(link);link.click();
 fresh();await pause();assert.deepEqual([...w.document.querySelector('#courseId').options].map(o=>o.value),['','F1','F2'],'a new visit starts filtered to the default');dom.window.close();
});
