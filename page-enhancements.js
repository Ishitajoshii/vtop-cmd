(() => {
  'use strict';
  const api = globalThis.VtopEnhancements, semesters = globalThis.VtopSemesters;
  if (!api || !semesters) return;
  const clean = text => (text || '').replace(/\s+/g,' ').trim();
  const isTerm = option => /^(fall|winter|summer|spring|tri|inter[ -]?session)\b.*?\b(?:semester|sem)\b/i.test(clean(option.textContent));
  const optionTerm = option => semesters.key(clean(option.textContent).match(/^(.+?\b\d{4}\s*[-–—/]\s*(?:\d{4}|\d{2}))(?=\s*(?:[-–—]|$))/i)?.[1] || option.textContent);
  const sameNodes = (a,b) => a.length === b.length && a.every((node,index)=>node===b[index]);
  const courseStates = new WeakMap(), attendanceStates = new WeakMap();
  const courseHosts = new Map();
  let preference = null, ready = false;
  // All semesters stays chosen for the rest of this page visit, even when VTOP re-renders the course list.
  let showAllCourses = false;
  document.addEventListener('vtop-page-visit',()=>{showAllCourses=false;});

  function courseDropdown(select) {
    if (select.multiple || select.disabled) return false;
    const identity = [select.id, select.name, ...[...(select.labels||[])].map(label=>label.textContent)].join(' ');
    const choices=[...select.options];
    const courseLabels=choices.some(option=>isTerm(option)&&/\b\d{4}[-–—/]\d{2,4}\s*[-–—]\s*[a-z]{2,}\d{2,}/i.test(clean(option.textContent)));
    return (/course/i.test(identity)||courseLabels) && choices.some(isTerm);
  }
  function snapshot(select) {
    const children = new Map([[select,[...select.childNodes]]]);
    for (const group of select.querySelectorAll('optgroup')) children.set(group,[...group.childNodes]);
    return children;
  }
  function createCourseState(select) {
    const host = document.createElement('div'); host.className='vtop-course-scope';
    const shadow = host.attachShadow({mode:'open'});
    shadow.innerHTML=`<style>:host{display:block;margin:8px 0 12px;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:inherit}.bar{display:flex;gap:7px;align-items:center;flex-wrap:wrap}button{font:inherit;padding:6px 10px;border:1px solid #8597af;border-radius:7px;background:transparent;color:inherit;cursor:pointer}button[aria-pressed=true]{background:#2459b8;color:#fff;border-color:#2459b8}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:2px solid #5a86e8;outline-offset:2px}p{font-size:12px;margin:5px 0;opacity:.85}</style><div class="bar" role="group" aria-label="Course semester filter"><span>Courses:</span><button type="button" class="default" aria-pressed="true">Default semester</button><button type="button" class="all" aria-pressed="false">All semesters</button></div><p role="status"></p>`;
    select.before(host);
    const state = {host,shadow,children:snapshot(select),expected:[...select.options],showAll:showAllCourses};
    courseHosts.set(host,select);
    shadow.querySelector('.default').addEventListener('click',()=>{
      // With no default yet, the button opens the launcher's semester picker instead of doing nothing.
      if(!preference?.label){document.getElementById('vtop-command-root')?.dispatchEvent(new CustomEvent('vtop-choose-semester'));return;}
      state.showAll=showAllCourses=false;filterCourses(select,state);
    });
    shadow.querySelector('.all').addEventListener('click',()=>{state.showAll=showAllCourses=true;filterCourses(select,state);});
    return state;
  }
  function filterCourses(select,state) {
    const original = [...state.children.values()].flat().filter(node=>node instanceof HTMLOptionElement);
    const target = preference?.label ? semesters.key(preference.label) : null;
    const all = state.showAll || !target;
    const allowed = option => all || !isTerm(option) && (!option.value || ['0','-1'].includes(option.value) || /^(?:--|choose|select|registered courses)/i.test(clean(option.textContent))) || isTerm(option) && optionTerm(option)===target;
    const currentValue=select.value;
    // Keep the original option nodes/attributes. Detached options are restored by All semesters.
    for (const [parent,nodes] of [...state.children.entries()].reverse()) {
      const visible=nodes.filter(node=>node instanceof HTMLOptionElement ? allowed(node) : node instanceof HTMLOptGroupElement ? [...node.querySelectorAll('option')].length>0 : true);
      if(!sameNodes([...parent.childNodes],visible)) parent.replaceChildren(...visible);
    }
    const optionStillVisible=[...select.options].some(option=>option.value===currentValue);
    if(optionStillVisible) select.value=currentValue;
    else { const placeholder=[...select.options].find(option=>!isTerm(option)); select.selectedIndex=placeholder?placeholder.index:-1; }
    state.expected=[...select.options];
    select.dataset.vtopSemesterScope=all?'all':target;
    state.shadow.querySelector('.default').title=target?'':'Choose a default semester';
    state.shadow.querySelector('.default').setAttribute('aria-pressed',String(!all));
    state.shadow.querySelector('.all').setAttribute('aria-pressed',String(all));
    const count=original.filter(option=>isTerm(option)&&(all||optionTerm(option)===target)).length;
    const message=all ? `${count} courses across all semesters.${target?'':' Choose Default semester to pick one and filter them.'}` :
      count ? `${count} ${count===1?'course':'courses'} · ${preference.label}` : `No courses for ${preference.label}. Choose All semesters to browse other terms.`;
    const status=state.shadow.querySelector('p');if(status.textContent!==message)status.textContent=message;
    if(select.value!==currentValue){
      select.dispatchEvent(new Event('change',{bubbles:true}));
    }
  }
  function scanCourses() {
    if(!ready)return;
    for(const [host,select] of courseHosts)if(!select.isConnected){host.remove();courseHosts.delete(host);}
    for(const select of document.querySelectorAll('select')) {
      let state=courseStates.get(select);
      if(!state&&!courseDropdown(select))continue;
      if(!state){state=createCourseState(select);courseStates.set(select,state);}
      else if(!sameNodes([...select.options],state.expected)) {
        // VTOP replaced the options; discard the old snapshot rather than reviving stale courses.
        state.children=snapshot(select);
      }
      if(!state.host.isConnected)select.before(state.host);
      filterCourses(select,state);
    }
  }
  function scanAttendance() {
    for(const table of document.querySelectorAll('table')) {
      const rows=[...table.rows].filter(row=>row.closest('table')===table);
      const header=rows.find(row=>[...row.cells].some(cell=>/attended (?:classes|days)/i.test(cell.textContent)));
      if(!header)continue;
      const headings=[...header.cells].map(cell=>clean(cell.textContent));
      const a=headings.findIndex(text=>/attended/i.test(text)),t=headings.findIndex(text=>/total (?:classes|days)|conducted/i.test(text)),p=headings.findIndex(text=>/attendance percentage/i.test(text));
      if(a<0||t<0)continue;
      for(const row of rows.slice(rows.indexOf(header)+1)) {
        if(row.cells.length!==headings.length)continue;
        const attendedText=clean(row.cells[a].textContent),totalText=clean(row.cells[t].textContent);
        if(!/^\d+$/.test(attendedText)||!/^\d+$/.test(totalText))continue;
        const attended=Number(attendedText),total=Number(totalText);if(!api.attendance(attended,total))continue;
        let state=attendanceStates.get(row);
        if(!state||!state.host.isConnected) {
          const host=document.createElement('div');host.className='vtop-row-attendance';
          const shadow=host.attachShadow({mode:'open'});
          shadow.innerHTML=`<style>:host{display:block;min-width:170px;margin-top:8px;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:inherit}.target{text-align:center;opacity:.8}p{margin:5px 0 0;white-space:normal;text-align:center}</style><div class="target">Target: 75%</div><p role="status" aria-live="polite"></p>`;
          (row.cells[p>=0?p:t]).append(host);
          state={host,shadow,attended,total};attendanceStates.set(row,state);
          host.title='Estimate using equally weighted future classes.';
        }
        state.attended=attended;state.total=total;renderAttendance(state);
      }
    }
  }
  function renderAttendance(state) {
    const result=api.attendance(state.attended,state.total,75);
    const message=!result?'Attendance counts unavailable.':result.percentage===null?'No classes recorded yet.':result.needed>0?`Attend ${result.needed} more ${result.needed===1?'class':'classes'} to reach 75%.`:`Can miss ${result.missable} more ${result.missable===1?'class':'classes'} at 75%.`;
    const output=state.shadow.querySelector('p');if(output.textContent!==message)output.textContent=message;
  }
  // Digital Assignment Upload: deadlines beside each course, read from the dashboards VTOP's own Dashboard
  // button opens. Read-only, one request at a time, kept in memory only, and stopped once a dashboard is opened.
  const DUE_STYLE=`:host{display:block;margin-top:2px;font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:inherit;text-align:left}
    ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}li{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap}.muted{opacity:.6}
    .chips{display:flex;flex-wrap:wrap;gap:6px}
    .badge,.chip{border:1px solid currentColor;border-radius:6px;padding:1px 8px;font-size:11px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
    .chip{position:relative;min-width:56px;text-align:center;cursor:default;outline:none}
    .chip::after{content:attr(data-tip);position:absolute;right:0;bottom:calc(100% + 6px);z-index:10;padding:5px 8px;border-radius:6px;background:#182438;color:#fff;font-weight:500;white-space:nowrap;box-shadow:0 4px 14px #0003;opacity:0;transform:translateY(2px);pointer-events:none;transition:opacity .12s,transform .12s}
    .chip:hover::after,.chip:focus-visible::after{opacity:1;transform:none}.chip:focus-visible{box-shadow:0 0 0 2px #3664d955}
    .pending{color:#3664d9}.soon{color:#c26a00}.overdue{color:#d93036}.done{color:#23845a}
    li.pending,li.soon,li.overdue,li.done{color:inherit}.pending .badge{color:#3664d9}.soon .badge{color:#c26a00}.overdue .badge{color:#d93036}.done .badge{color:#23845a}
    :host-context(html[data-vtop-command-dark]) :is(.pending,.pending .badge){color:#9cbcff}:host-context(html[data-vtop-command-dark]) :is(.soon,.soon .badge){color:#ffc46b}
    :host-context(html[data-vtop-command-dark]) :is(.overdue,.overdue .badge){color:#ff8f96}:host-context(html[data-vtop-command-dark]) :is(.done,.done .badge){color:#83d9ae}
    :host-context(html[data-vtop-command-dark]) li:is(.pending,.soon,.overdue,.done){color:inherit}
    :host-context(html[data-vtop-command-dark]) .chip::after{background:#edf1fa;color:#182438}`;
  const deadlineCache=new Map(), deadlineStates=new WeakMap(), dueStates=new WeakMap(), liveBadges=new Set();
  // Each course's dashboard is reused for a random 1–5 hours, so refreshes never line up and VTOP sees far
  // fewer requests. Entries live in chrome.storage.session (memory only, cleared when Chrome closes), never on disk.
  const MIN_CACHE=60*60000, MAX_CACHE=5*60*60000, cacheLifetime=()=>MIN_CACHE+Math.random()*(MAX_CACHE-MIN_CACHE);
  const sessionArea=(()=>{try{return chrome.storage.session||null;}catch{return null;}})();
  const cacheReady=(async()=>{
    try{
      const saved=(await sessionArea?.get('deadlineCache'))?.deadlineCache;
      for(const [classId,entry] of Object.entries(saved&&typeof saved==='object'?saved:{}))
        if(Array.isArray(entry?.records)&&entry.expires>Date.now()&&!deadlineCache.has(classId))deadlineCache.set(classId,{status:'done',records:entry.records,expires:entry.expires});
    }catch{/* No session access: this page's memory only. */}
  })();
  function persistDeadlines(){
    if(!sessionArea)return;
    const now=Date.now(),entries={};
    for(const [classId,entry] of deadlineCache)if(entry.status==='done'&&entry.expires>now)entries[classId]={records:entry.records,expires:entry.expires};
    try{sessionArea.set({deadlineCache:entries})?.catch(()=>{});}catch{/* Extension reloaded. */}
  }
  function storeDeadlines(classId,records){deadlineCache.set(classId,{status:'done',records,expires:Date.now()+cacheLifetime()});persistDeadlines();}
  const freshDeadlines=classId=>{const entry=deadlineCache.get(classId);return entry?.status==='done'&&entry.expires>Date.now()?entry:null;};
  let deadlineQueue=[], deadlineController=null, deadlineRunning=false;
  const istDate=(time,dateOnly)=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',...(dateOnly?{}:{hour:'numeric',minute:'2-digit'})}).format(time);
  function badgeHost(cell,className){
    const host=document.createElement('div');host.className=className;
    const shadow=host.attachShadow({mode:'open'});shadow.innerHTML=`<style>${DUE_STYLE}</style><ul></ul>`;
    cell.append(host);return {host,shadow};
  }
  function line(record){
    const state=api.dueState(record),item=document.createElement('li');item.className=state.tone;
    const badge=document.createElement('span');badge.className='badge';badge.textContent=state.text;
    item.title=`Due ${istDate(record.time,false)} IST${record.dateOnly?' (date only; end of day assumed)':''}`;
    return {item,badge};
  }
  function renderDeadlines(state){
    const entry=deadlineCache.get(state.classId),list=state.shadow.querySelector('ul');list.replaceChildren();
    if(!entry||entry.status==='loading'){const item=document.createElement('li');item.className='muted';item.textContent='Loading…';list.append(item);return;}
    if(entry.status==='stopped'){const item=document.createElement('li');item.className='muted';item.textContent='Open to see';item.title="Loading stopped when a dashboard was opened. Open this course's dashboard to see its deadlines.";list.append(item);return;}
    if(entry.status==='error'){const item=document.createElement('li');item.className='muted';item.textContent='Unavailable';item.title='Deadlines could not be loaded. Open the dashboard to check.';list.append(item);return;}
    // Submitted work is done; only what still needs attention is listed, as uniform date chips.
    // The assignment and its countdown appear on hover or keyboard focus.
    const records=entry.records.filter(record=>!record.submitted).sort((a,b)=>a.time-b.time);
    if(!records.length){const item=document.createElement('li');item.className='muted';item.textContent='—';item.title='Nothing pending';item.setAttribute('aria-label','Nothing pending');list.append(item);return;}
    const item=document.createElement('li'),chips=document.createElement('div');chips.className='chips';
    for(const record of records){
      const due=api.dueState(record),chip=document.createElement('span');
      chip.className=`chip ${due.tone}`;chip.tabIndex=0;chip.textContent=istDate(record.time,true);
      chip.dataset.tip=`${record.title} · ${due.text}`;chip.setAttribute('aria-label',`${record.title}, ${due.text}, due ${istDate(record.time,record.dateOnly)}`);
      chips.append(chip);
    }
    item.append(chips);list.append(item);
  }
  async function loadDeadlines(classId,signal){
    const csrf=document.querySelector('input[name="_csrf"]')?.value,id=document.querySelector('#authorizedID')?.value||document.querySelector('#authorizedIDX')?.value;
    if(!csrf||!id)throw new Error('Not signed in');
    const response=await fetch(new URL('examinations/processDigitalAssignment',document.baseURI),{method:'POST',credentials:'same-origin',signal,
      headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:csrf,classId,authorizedID:id,x:new Date().toUTCString()})});
    const html=response.ok?await response.text():'';
    if(!html||html.includes('___INTERNAL___RESPONSE___'))throw new Error('Unavailable');
    return summarise(api.assignmentRows(new DOMParser().parseFromString(html,'text/html')));
  }
  const summarise=records=>records.map(({title,label,time,dateOnly,submitted})=>({title:title||label,time,dateOnly,submitted}));
  // The open dashboard's own Class Number, so what you see there refreshes the cache (e.g. right after an upload).
  function dashboardClassId(){
    for(const table of document.querySelectorAll('table')){
      const rows=[...table.rows],headers=rows[0]?[...rows[0].cells].map(cell=>clean(cell.textContent)):[];
      const index=headers.findIndex(text=>/^class (?:number|nbr)$/i.test(text));
      if(index<0||headers.some(text=>/dashboard/i.test(text)))continue;
      const value=clean(rows[1]?.cells[index]?.textContent);if(/^[A-Z]{2}\d{6,}$/.test(value))return value;
    }
    return null;
  }
  async function pumpDeadlines(){
    if(deadlineRunning)return;deadlineRunning=true;
    try{
      await cacheReady;
      while(deadlineQueue.length){
        const {classId,state}=deadlineQueue.shift();if(!state.host.isConnected)continue;
        if(freshDeadlines(classId)){renderDeadlines(state);continue;}
        deadlineCache.set(classId,{status:'loading'});renderDeadlines(state);
        deadlineController=new AbortController();
        try{storeDeadlines(classId,await loadDeadlines(classId,deadlineController.signal));}
        catch(error){if(error?.name==='AbortError'){deadlineCache.set(classId,{status:'stopped'});if(state.host.isConnected)renderDeadlines(state);break;}deadlineCache.set(classId,{status:'error'});}
        if(state.host.isConnected)renderDeadlines(state);
      }
    }finally{deadlineRunning=false;deadlineController=null;}
  }
  // Rows still waiting say so instead of showing Loading… forever; a fresh course list queues them again.
  function stopDeadlines(){
    for(const {classId,state} of deadlineQueue)if(!freshDeadlines(classId)){deadlineCache.set(classId,{status:'stopped'});if(state.host.isConnected)renderDeadlines(state);}
    deadlineQueue=[];deadlineController?.abort();
  }
  // An upload changes what is pending. Forget that course (so the list asks VTOP again) and stop re-caching
  // this dashboard view, which may still show the pre-upload state until VTOP refreshes it.
  let uploadedClass=null;
  function forgetDeadlines(control){
    const classId=control?.closest?.('form')?.querySelector('input[name="classIdNumber"],input[name="classId1"]')?.value||dashboardClassId();
    // An upload whose course can't be told apart releases every course, so nothing stale survives it.
    if(!classId){cacheReady.then(()=>{if(deadlineCache.size){deadlineCache.clear();persistDeadlines();}});return;}
    uploadedClass=classId;
    cacheReady.then(()=>{if(deadlineCache.delete(classId))persistDeadlines();});
  }
  document.addEventListener('change',event=>{if(event.target?.matches?.('input[type=file]'))forgetDeadlines(event.target);},true);
  document.addEventListener('submit',event=>{if(event.target?.querySelector?.('input[type=file]'))forgetDeadlines(event.target);},true);
  document.addEventListener('click',event=>{
    const control=event.target.closest?.('button,input[type=button],input[type=submit],a');
    if(control&&dashboardClassId()&&/upload|submit|save/i.test(`${control.id} ${control.getAttribute('name')||''} ${control.textContent} ${control.value||''} ${control.getAttribute('class')||''}`))forgetDeadlines(control);
  },true);
  // Opening a course hands the page back to VTOP; never race its own dashboard request.
  document.addEventListener('click',event=>{if(event.target.closest?.('[onclick*="myFunction"]'))stopDeadlines();},true);
  function scanDeadlines(){
    const courses=api.assignmentCourses(document);
    for(const course of courses){
      // A dedicated column just before Dashboard, so VTOP's own cells stay untouched.
      if(!course.headerRow.querySelector(':scope > .vtop-deadline-col')){
        const dashboardHeader=[...course.headerRow.cells].find(cell=>/dashboard/i.test(cell.textContent))||null;
        const heading=document.createElement(dashboardHeader?.tagName==='TH'?'th':'td');heading.className='vtop-deadline-col';heading.textContent='Pending';
        course.headerRow.insertBefore(heading,dashboardHeader);
      }
      let cell=course.row.querySelector(':scope > .vtop-deadline-col');
      if(!cell){cell=document.createElement('td');cell.className='vtop-deadline-col';course.row.insertBefore(cell,course.dashboardCell);}
      let state=deadlineStates.get(course.row);
      if(state&&state.host.isConnected&&state.classId===course.classId)continue;
      state={...badgeHost(cell,'vtop-course-deadlines'),classId:course.classId};deadlineStates.set(course.row,state);liveBadges.add(state);
      deadlineQueue.push({classId:course.classId,state});
    }
    if(courses.length)pumpDeadlines();
    const dashboardRecords=api.assignmentRows(document),openClass=dashboardClassId();
    if(openClass!==uploadedClass)uploadedClass=null;
    if(openClass&&openClass!==uploadedClass&&[...document.querySelectorAll('td,th')].some(cell=>/^due date$/i.test(clean(cell.textContent)))){
      const fresh=summarise(dashboardRecords);
      cacheReady.then(()=>{if(JSON.stringify(fresh)!==JSON.stringify(freshDeadlines(openClass)?.records))storeDeadlines(openClass,fresh);});
    }
    for(const record of dashboardRecords){
      if(!record.dueCell||!record.row)continue;
      let state=dueStates.get(record.row);
      // VTOP's Last Updated On column already shows submissions; countdowns are for pending work only.
      if(record.submitted){if(state?.host.isConnected)state.host.remove();continue;}
      if(!state||!state.host.isConnected){state=badgeHost(record.dueCell,'vtop-due-countdown');dueStates.set(record.row,state);liveBadges.add(state);}
      state.record=record;renderDue(state);
    }
  }
  function renderDue(state){
    const {item,badge}=line(state.record);item.append(badge);
    // Scans run on every page change; only redraw when the countdown text actually differs.
    const list=state.shadow.querySelector('ul');if(list.textContent!==item.textContent)list.replaceChildren(item);
  }
  // Refresh countdowns each minute, except one you're hovering or focused on, so its tooltip and focus stay put.
  setInterval(()=>{for(const state of liveBadges){if(!state.host.isConnected){liveBadges.delete(state);continue;}if(state.shadow.activeElement||state.host.matches(':hover'))continue;state.record?renderDue(state):renderDeadlines(state);}},60000);
  // Marks: each course's mark table ends with a Total row for Max. Mark, Weightage %, Scored Mark and Weightage Mark.
  // Its Remark cell shows the marks already lost: Weightage % total − Weightage Mark total.
  const MARK_COLUMNS=[/^max\.?\s*mark$/i,/^weightage\s*%$/i,/^scored\s*mark$/i,/^weightage\s*mark$/i];
  const markNumber=text=>/^-?\d+(?:\.\d+)?$/.test(text)?Number(text):null;
  const markFormat=value=>String(Math.round(value*100)/100);
  // Update only a cell's leading text, so a note added after it survives.
  function markText(cell,text){let node=cell.firstChild;if(!(node instanceof Text)){node=document.createTextNode('');cell.prepend(node);}if(node.data!==text)node.data=text;}
  function scanMarks(){
    for(const table of document.querySelectorAll('table')){
      const header=table.rows[0];if(!header)continue;
      const titles=[...header.cells].map(cell=>clean(cell.textContent));
      const titleIndex=titles.findIndex(title=>/^mark\s*title$/i.test(title)),remarkIndex=titles.findIndex(title=>/^remarks?$/i.test(title));
      const columns=MARK_COLUMNS.map(pattern=>titles.findIndex(title=>pattern.test(title)));
      if(titleIndex<0||columns.some(index=>index<0))continue;
      let total=[...table.rows].find(row=>row.classList.contains('vtop-mark-total'));
      const rows=[...table.rows].slice(1).filter(row=>row!==total&&row.cells.length===header.cells.length);
      if(!rows.length){total?.remove();continue;}
      const sums=columns.map(index=>{
        const values=rows.map(row=>markNumber(clean(row.cells[index].textContent))).filter(value=>value!==null);
        return values.length?values.reduce((sum,value)=>sum+value,0):null;
      });
      if(!total){
        total=document.createElement('tr');total.className=`${rows[0].className} vtop-mark-total`.trim();
        for(let i=0;i<header.cells.length;i++)total.append(document.createElement('td'));
        markText(total.cells[titleIndex],'Total');
      }
      columns.forEach((index,i)=>markText(total.cells[index],sums[i]===null?'—':markFormat(sums[i])));
      const [,weightage,,weighted]=sums,lost=weightage!==null&&weighted!==null?Math.max(0,weightage-weighted):null;
      // Without a Remark column, the note sits beside the weightage total instead.
      const cell=total.cells[remarkIndex>=0?remarkIndex:columns[3]],text=lost===null?'':`${markFormat(lost)} marks lost`;
      let note=cell.querySelector('.vtop-mark-lost');
      if(!text)note?.remove();
      else if(note?.textContent!==text){if(!note){note=document.createElement('span');note.className=remarkIndex>=0?'vtop-mark-lost':'vtop-mark-lost beside';cell.append(note);}note.textContent=text;}
      // Keep it last even when VTOP appends rows to the same table.
      if(total!==table.rows[table.rows.length-1])rows.at(-1).parentElement.append(total);
    }
  }
  function scan(){scanCourses();scanAttendance();scanDeadlines();scanMarks();}
  try {
    chrome.storage.local.get('defaultSemester').then(settings=>{preference=settings.defaultSemester;ready=true;scan();}).catch(()=>{ready=true;scan();});
    // A default saved in another tab applies from the next page; only a save in this tab re-filters what's on screen.
    chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.defaultSemester)preference=changes.defaultSemester.newValue;});
    document.addEventListener('vtop-default-semester-saved',event=>{preference=event.detail;scanCourses();});
  } catch {ready=true;}
  scanAttendance();scanDeadlines();
  let pending;
  new MutationObserver(()=>{clearTimeout(pending);pending=setTimeout(scan,110);}).observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','value','id','name']});
})();
