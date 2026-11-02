const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(__dirname+'/../pdf-bridge.js','utf8');
const pause=()=>new Promise(resolve=>setTimeout(resolve,35));
function bridge({body='%PDF-1.4\nmock',type='application/pdf',ok=true,navigation=false}={}){
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only',url:'https://vtop.vit.ac.in/vtop/content'}),w=dom.window;
 const calls=[],messages=[],opens=[],downloads=[];
 let blobNumber=0;
 w.Blob=Blob;w.fetch=async(url,init)=>{calls.push({url,init});return{ok,blob:async()=>new Blob([body],{type}),headers:{get:()=>"attachment; filename*=UTF-8''Lecture%20notes.pdf"}};};
 w.URL.createObjectURL=()=>`blob:https://vtop.vit.ac.in/${++blobNumber}`;w.URL.revokeObjectURL=()=>{};
 w.open=(...args)=>opens.push(args);
 w.HTMLAnchorElement.prototype.click=function(){downloads.push({href:this.href,name:this.download});};
 w.HTMLFormElement.prototype.submit=function(){calls.push({native:true});};
 if(navigation)w.navigation=new w.EventTarget();
 w.addEventListener('message',event=>messages.push(event.data));w.eval(source);
 return{dom,w,calls,messages,opens,downloads};
}
test('VTOP window.open download becomes a PDF preview using original authenticated GET',async()=>{
 const {dom,w,calls,messages,opens}=bridge();
 w.open('downloadSpotLightViewFile/820?token=test');await pause();
 assert.equal(opens.length,0);assert.equal(calls.length,1);assert.equal(calls[0].init.credentials,'same-origin');
 assert.ok(calls[0].url.includes('token=test'));
 const ready=messages.find(m=>m.kind==='ready');assert.ok(ready);assert.equal(ready.filename,'Lecture notes.pdf');
 assert.ok(!JSON.stringify(messages).includes('token=test'));dom.window.close();
});
test('external URLs and ordinary VTOP navigation retain native browser behavior',async()=>{
 const {dom,w,calls,opens}=bridge();w.open('https://example.com/file.pdf');w.open('/vtop/academics/home');
 assert.equal(opens.length,2);assert.equal(calls.length,0);dom.window.close();
});
test('PDF blob anchors are intercepted even when detached; non-PDF responses keep download behavior',async()=>{
 const a=bridge();const anchor=a.w.document.createElement('a');anchor.href=a.w.URL.createObjectURL(new a.w.Blob(['%PDF-1.4'],{type:'application/pdf'}));anchor.download='notes.pdf';anchor.click();await pause();
 assert.ok(a.messages.some(m=>m.kind==='ready'));assert.equal(a.downloads.length,0);a.dom.window.close();
 const b=bridge({body:'spreadsheet',type:'application/vnd.ms-excel'});b.w.open('/vtop/download/report');await pause();
 assert.equal(b.downloads.length,1);assert.ok(b.messages.some(m=>m.kind==='not-pdf'));b.dom.window.close();
});
test('POST download forms retain fields; non-download/file-upload forms are left alone',async()=>{
 const {dom,w,calls,messages}=bridge();
 const form=w.document.createElement('form');form.method='POST';form.action='/vtop/download/document';form.innerHTML='<input name="_csrf" value="test-only"><input name="course" value="sample">';w.document.body.append(form);form.submit();await pause();
 assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.body.get('_csrf'),'test-only');assert.ok(messages.some(m=>m.kind==='ready'));
 form.action='/vtop/upload';form.submit();assert.equal(calls.at(-1).native,true);
 form.action='/vtop/download/upload';form.innerHTML='<input type="file">';form.submit();assert.equal(calls.at(-1).native,true);dom.window.close();
});
test('expired sessions show an error instead of downloading HTML as PDF',async()=>{
 const {dom,w,messages,downloads}=bridge({body:'<html>Sign in</html>',type:'text/html'});w.open('/vtop/download/file');await pause();
 assert.ok(messages.some(m=>m.kind==='error'));assert.equal(downloads.length,0);dom.window.close();
});
test('PDF resources are bundled locally and MAIN interception is scoped only to VTOP',()=>{
 const manifest=JSON.parse(fs.readFileSync(__dirname+'/../manifest.json'));
 const main=manifest.content_scripts.find(script=>script.world==='MAIN');assert.deepEqual(main.matches,['https://vtop.vit.ac.in/vtop/*']);assert.equal(main.run_at,'document_start');
 assert.deepEqual(manifest.permissions,['storage']);
 for(const file of ['pdf-viewer.html','pdf-viewer.mjs','pdf-viewer.css'])assert.ok(fs.existsSync(__dirname+'/../'+file));
 assert.ok(!fs.readFileSync(__dirname+'/../pdf-viewer.html','utf8').includes('https://'));
});
test('Shift-click bypasses the viewer for native javascript download helpers',()=>{
 const {dom,w,opens,calls}=bridge();const anchor=w.document.createElement('a');anchor.href='javascript:void(0)';anchor.addEventListener('click',()=>w.open('/vtop/download/original'));w.document.body.append(anchor);
 anchor.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true,shiftKey:true}));
 assert.equal(opens.length,1);assert.equal(calls.length,0);dom.window.close();
});
test('preview ignores forged origins and non-local blob references',()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only',url:'https://vtop.vit.ac.in/vtop/content'}),w=dom.window;
 w.chrome={runtime:{getURL:name=>'chrome-extension://test-extension/'+name}};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 let fetched=0;w.fetch=async()=>{fetched++;throw new Error('Should not fetch');};
 w.eval(fs.readFileSync(__dirname+'/../brand.js','utf8'));w.eval(fs.readFileSync(__dirname+'/../pdf-preview.js','utf8'));
 const send=(origin,kind,extra={})=>w.dispatchEvent(new w.MessageEvent('message',{source:w,origin,data:{source:'vtop-command-pdf',id:'pdf-1-1',kind,...extra}}));
 send('https://attacker.example','loading');const dialog=w.document.querySelector('#vtop-pdf-preview').shadowRoot.querySelector('dialog');assert.equal(dialog.open,false);
 send(w.location.origin,'loading');assert.equal(dialog.open,true);
 send(w.location.origin,'ready',{blobUrl:'https://attacker.example/private.pdf'});assert.equal(fetched,0);dom.window.close();
});
test('a click on the preview backdrop closes it; clicks inside do not',()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only',url:'https://vtop.vit.ac.in/vtop/content'}),w=dom.window;
 w.chrome={runtime:{getURL:name=>'chrome-extension://test-extension/'+name}};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.eval(fs.readFileSync(__dirname+'/../brand.js','utf8'));w.eval(fs.readFileSync(__dirname+'/../pdf-preview.js','utf8'));
 w.dispatchEvent(new w.MessageEvent('message',{source:w,origin:w.location.origin,data:{source:'vtop-command-pdf',id:'pdf-1-1',kind:'loading'}}));
 const dialog=w.document.querySelector('#vtop-pdf-preview').shadowRoot.querySelector('dialog');dialog.getBoundingClientRect=()=>({left:20,right:980,top:20,bottom:700});
 dialog.dispatchEvent(new w.MouseEvent('click',{bubbles:true,clientX:500,clientY:300}));assert.equal(dialog.open,true);
 dialog.querySelector('h2').dispatchEvent(new w.MouseEvent('click',{bubbles:true,clientX:5,clientY:5}));assert.equal(dialog.open,true);
 dialog.dispatchEvent(new w.MouseEvent('click',{bubbles:true,clientX:5,clientY:5}));assert.equal(dialog.open,false);dom.window.close();
});
test('preview Download keeps original PDF bytes and filename, and Close revokes temporary data',async()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only',url:'https://vtop.vit.ac.in/vtop/content'}),w=dom.window;
 const bytes=new TextEncoder().encode('%PDF-1.4\noriginal bytes').buffer,revoked=[];
 w.chrome={runtime:{getURL:name=>'chrome-extension://test-extension/'+name}};
 w.TextDecoder=TextDecoder;w.Blob=Blob;w.fetch=async()=>({arrayBuffer:async()=>bytes});
 w.URL.createObjectURL=()=> 'blob:https://vtop.vit.ac.in/original-copy';w.URL.revokeObjectURL=url=>revoked.push(url);
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.eval(fs.readFileSync(__dirname+'/../brand.js','utf8'));w.eval(fs.readFileSync(__dirname+'/../pdf-preview.js','utf8'));
 const send=(kind,extra={})=>w.dispatchEvent(new w.MessageEvent('message',{source:w,origin:w.location.origin,data:{source:'vtop-command-pdf',id:'pdf-1-1',kind,...extra}}));
 send('loading');send('ready',{blobUrl:'blob:https://vtop.vit.ac.in/native-document',filename:'Lecture.pdf'});await pause();
 const shadow=w.document.querySelector('#vtop-pdf-preview').shadowRoot,download=shadow.querySelector('a');
 assert.equal(download.hidden,false);assert.equal(download.download,'Lecture.pdf');assert.equal(download.href,'blob:https://vtop.vit.ac.in/original-copy');
 shadow.querySelector('button').click();assert.equal(download.hidden,true);assert.deepEqual(revoked,['blob:https://vtop.vit.ac.in/original-copy']);dom.window.close();
});
test('real Curriculum button submits curriculDown form to the viewer once with authenticated POST fields',async()=>{
 const {dom,w,calls,messages}=bridge();const form=w.document.createElement('form');form.id='curriculumDownloadForm';form.method='post';form.action='academics/curriculDown/';
 form.innerHTML='<input type="hidden" name="_csrf" value="mock-csrf"><input type="hidden" name="authorizedID" value="mock-user"><input type="hidden" name="regNo" value="mock-registration">';
 const button=w.document.createElement('button');button.type='button';button.id='curriculumDownload';button.textContent='Download Curriculum as PDF';button.addEventListener('click',()=>form.submit());w.document.body.append(form,button);
 button.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));await pause();
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://vtop.vit.ac.in/vtop/academics/curriculDown/');assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.body.get('regNo'),'mock-registration');assert.equal(calls[0].init.body.get('_csrf'),'mock-csrf');assert.ok(messages.some(message=>message.kind==='ready'));dom.window.close();
});
test('PDF-labelled controls cover opaque form and window.open endpoints without changing unrelated forms',async()=>{
 const a=bridge();const form=a.w.document.createElement('form');form.method='post';form.action='academics/render/42';form.innerHTML='<input name="report" value="sample">';
 const button=a.w.document.createElement('button');button.textContent='Download as PDF';button.addEventListener('click',()=>form.submit());a.w.document.body.append(form,button);button.dispatchEvent(new a.w.MouseEvent('click',{bubbles:true,cancelable:true}));await pause();
 assert.equal(a.calls[0].init.method,'POST');assert.ok(a.messages.some(message=>message.kind==='ready'));a.dom.window.close();
 const b=bridge();const control=b.w.document.createElement('button');control.textContent='View PDF';control.addEventListener('click',()=>b.w.open('academics/render/42'));b.w.document.body.append(control);control.dispatchEvent(new b.w.MouseEvent('click',{bubbles:true,cancelable:true}));await pause();assert.equal(b.opens.length,0);assert.ok(b.messages.some(message=>message.kind==='ready'));b.dom.window.close();
});
test('PDF download attributes on opaque URLs, data URLs and dwnld endpoints open the viewer',async()=>{
 for(const href of ['academics/render/42','data:application/pdf;base64,JVBERi0xLjQ=','academics/courseDwnld/42']){
  const {dom,w,messages}=bridge();const link=w.document.createElement('a');link.href=href;link.download='Course.pdf';link.click();await pause();assert.ok(messages.some(message=>message.kind==='ready'),href);dom.window.close();
 }
});
test('Shift-click bypass also preserves original programmatic PDF form submission',()=>{
 const {dom,w,calls}=bridge();const form=w.document.createElement('form');form.id='curriculumDownloadForm';form.method='post';form.action='academics/curriculDown/';
 const button=w.document.createElement('button');button.textContent='Download Curriculum as PDF';button.addEventListener('click',()=>form.submit());w.document.body.append(form,button);button.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true,shiftKey:true}));assert.equal(calls.length,1);assert.equal(calls[0].native,true);dom.window.close();
});
test('download-labelled navigation entries stay native instead of fetching the current page as a PDF',async()=>{
 const {dom,w,calls}=bridge();let navigations=0;
 const link=w.document.createElement('a');link.href='#';link.className='systemB5BtnMenu';link.dataset.url='events/certificateDownload';link.textContent='Certificate Download';link.addEventListener('click',event=>{event.preventDefault();navigations++;});w.document.body.append(link);
 link.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));await pause();assert.equal(navigations,1);assert.equal(calls.length,0);dom.window.close();
});
function navigate(w,url,extra={}){
 const event=new w.Event('navigate',{cancelable:true});
 Object.defineProperties(event,{destination:{value:{url:new URL(url,w.location.href).href}},navigationType:{value:'push'},hashChange:{value:false},downloadRequest:{value:null},formData:{value:null},...Object.fromEntries(Object.entries(extra).map(([key,value])=>[key,{value}]))});
 w.navigation.dispatchEvent(event);return event;
}
test('Navigation API catches location-style downloads and POST navigations, leaving ordinary pages native',async()=>{
 const {dom,w,calls,messages}=bridge({navigation:true});
 const download=navigate(w,'/vtop/downloadQuestionPaper?id=7');await pause();
 assert.equal(download.defaultPrevented,true);assert.equal(calls[0].url,'https://vtop.vit.ac.in/vtop/downloadQuestionPaper?id=7');assert.ok(messages.some(m=>m.kind==='ready'));
 const fields=new w.FormData();fields.append('_csrf','test-only');
 const post=navigate(w,'/vtop/examinations/doDownload',{formData:fields});await pause();
 assert.equal(post.defaultPrevented,true);assert.equal(calls[1].init.method,'POST');assert.equal(calls[1].init.body.get('_csrf'),'test-only');
 const page=navigate(w,'/vtop/academics/home');const external=navigate(w,'https://example.com/file.pdf');const back=navigate(w,'/vtop/download/x',{navigationType:'traverse'});
 assert.equal(page.defaultPrevented,false);assert.equal(external.defaultPrevented,false);assert.equal(back.defaultPrevented,false);assert.equal(calls.length,2);dom.window.close();
});
test('Navigation API is read-only: a POST is sent once and never replayed, and file uploads are never touched',async()=>{
 const {dom,w,calls,messages}=bridge({navigation:true,body:'<html>Report</html>',type:'text/html'});
 const fields=new w.FormData();fields.append('report','7');
 navigate(w,'/vtop/download/report',{formData:fields});await pause();
 assert.equal(calls.length,1);assert.equal(calls[0].init.method,'POST');assert.ok(!calls.some(call=>call.native),'POST never replayed');assert.ok(messages.some(m=>m.kind==='error'));
 const intent=navigate(w,'/vtop/academics/saveSomething',{formData:fields});assert.equal(intent.defaultPrevented,false,'POST to a non-download endpoint stays native');assert.equal(calls.length,1);
 const upload=new w.FormData();upload.append('file',new w.File(['x'],'x.pdf'));
 assert.equal(navigate(w,'/vtop/download/upload',{formData:upload}).defaultPrevented,false);dom.window.close();
});
test('synthetic clicks on detached blob anchors and icon-only download buttons open the viewer',async()=>{
 const a=bridge();const anchor=a.w.document.createElement('a');anchor.href=a.w.URL.createObjectURL(new a.w.Blob(['%PDF-1.4']));anchor.download='saved';
 assert.equal(anchor.dispatchEvent(new a.w.MouseEvent('click',{cancelable:true})),false);await pause();
 assert.ok(a.messages.some(m=>m.kind==='ready'));assert.equal(a.downloads.length,0);a.dom.window.close();
 const b=bridge();const button=b.w.document.createElement('button');button.innerHTML='<i class="fa fa-download"></i>';button.addEventListener('click',()=>b.w.open('academics/render/42'));b.w.document.body.append(button);
 button.querySelector('i').dispatchEvent(new b.w.MouseEvent('click',{bubbles:true,cancelable:true}));await pause();
 assert.equal(b.opens.length,0);assert.ok(b.messages.some(m=>m.kind==='ready'));b.dom.window.close();
});
test('preview mounts a fresh viewer frame per document and delivers bytes on load',async()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only',url:'https://vtop.vit.ac.in/vtop/content'}),w=dom.window;
 w.chrome={runtime:{getURL:name=>'chrome-extension://test-extension/'+name}};
 w.TextDecoder=TextDecoder;w.Blob=Blob;w.fetch=async()=>({arrayBuffer:async()=>new TextEncoder().encode('%PDF-1.4').buffer});
 w.URL.createObjectURL=()=>'blob:https://vtop.vit.ac.in/copy';w.URL.revokeObjectURL=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.eval(fs.readFileSync(__dirname+'/../brand.js','utf8'));w.eval(fs.readFileSync(__dirname+'/../pdf-preview.js','utf8'));
 const shadow=w.document.querySelector('#vtop-pdf-preview').shadowRoot;
 const send=(id,kind,extra={})=>w.dispatchEvent(new w.MessageEvent('message',{source:w,origin:w.location.origin,data:{source:'vtop-command-pdf',id,kind,...extra}}));
 send('pdf-1-1','loading');send('pdf-1-1','ready',{blobUrl:'blob:https://vtop.vit.ac.in/a'});await pause();
 const first=shadow.querySelector('iframe');assert.ok(first);
 const posted=[];first.contentWindow.postMessage=(data,origin)=>posted.push({data,origin});first.dispatchEvent(new w.Event('load'));
 assert.equal(posted.length,1);assert.equal(posted[0].data.type,'pdf-data');assert.equal(posted[0].origin,'chrome-extension://test-extension');
 send('pdf-2-2','loading');assert.equal(shadow.querySelector('iframe'),null);
 send('pdf-2-2','ready',{blobUrl:'blob:https://vtop.vit.ac.in/b'});await pause();
 const second=shadow.querySelector('iframe');assert.ok(second&&second!==first);assert.notEqual(second.src,first.src);
 assert.equal(shadow.querySelectorAll('iframe').length,1);dom.window.close();
});
function previewWindow({dark=false}={}){
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only',url:'https://vtop.vit.ac.in/vtop/content'}),w=dom.window,listeners=[];
 w.chrome={runtime:{getURL:name=>'chrome-extension://test-extension/'+name},storage:{local:{get:async()=>({darkMode:dark})},onChanged:{addListener:listener=>listeners.push(listener)}}};
 w.TextDecoder=TextDecoder;w.Blob=Blob;w.fetch=async()=>({arrayBuffer:async()=>new TextEncoder().encode('%PDF-1.4').buffer});
 w.URL.createObjectURL=()=>'blob:https://vtop.vit.ac.in/copy';w.URL.revokeObjectURL=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.eval(fs.readFileSync(__dirname+'/../brand.js','utf8'));w.eval(fs.readFileSync(__dirname+'/../pdf-preview.js','utf8'));
 const host=w.document.querySelector('#vtop-pdf-preview'),shadow=host.shadowRoot;
 const send=(id,kind,extra={})=>w.dispatchEvent(new w.MessageEvent('message',{source:w,origin:w.location.origin,data:{source:'vtop-command-pdf',id,kind,...extra}}));
 return{dom,w,host,shadow,send,listeners};
}
test('preview shares the command menu palette and follows the saved dark mode, passing it to the viewer',async()=>{
 const {dom,w,host,shadow,send,listeners}=previewWindow({dark:true});await pause();
 assert.equal(host.hasAttribute('data-dark'),true);assert.match(shadow.querySelector('style').textContent,/--surface:#171d29/);
 assert.match(shadow.querySelector('.brand').textContent,/VTOP \/ PDF/);assert.equal(shadow.querySelector('.close').textContent,'Esc');
 send('pdf-1-1','loading');send('pdf-1-1','ready',{blobUrl:'blob:https://vtop.vit.ac.in/a'});await pause();
 assert.match(shadow.querySelector('iframe').src,/\?theme=dark#/);
 listeners.forEach(listener=>listener({darkMode:{newValue:false}},'local'));assert.equal(host.hasAttribute('data-dark'),false);dom.window.close();
});
test('Escape and Cmd/Ctrl+K forwarded from the viewer close the preview and reopen the command menu',async()=>{
 const {dom,w,shadow,send}=previewWindow();await pause();const keys=[];
 w.document.addEventListener('keydown',event=>keys.push(event.key));
 const open=async id=>{send(id,'loading');send(id,'ready',{blobUrl:'blob:https://vtop.vit.ac.in/a'});await pause();return shadow.querySelector('iframe');};
 const fromViewer=(frame,key)=>{const nonce=new URL(frame.src).hash.slice(1);w.dispatchEvent(new w.MessageEvent('message',{source:frame.contentWindow,origin:'chrome-extension://test-extension',data:{type:'viewer-key',key,nonce}}));};
 const dialog=shadow.querySelector('dialog');
 fromViewer(await open('pdf-1-1'),'Escape');assert.equal(dialog.open,false);assert.deepEqual(keys,[]);
 fromViewer(await open('pdf-2-2'),'k');assert.equal(dialog.open,false);assert.deepEqual(keys,['k']);dom.window.close();
});
test('VTOP downloadFileWithProgress: untyped blob revoked right after click still opens the viewer',async()=>{
 const {dom,w,messages,downloads}=bridge();const revoke=w.URL.revokeObjectURL;let revoked=0;w.URL.revokeObjectURL=url=>{revoked++;revoke(url);};
 const blob=new w.Blob(['%PDF-1.4 lecture']);const link=w.document.createElement('a');link.href=w.URL.createObjectURL(blob);link.download='Module 3';
 w.document.body.appendChild(link);link.click();w.document.body.removeChild(link);w.URL.revokeObjectURL(link.href);await pause();
 assert.ok(revoked>=1);assert.ok(messages.some(m=>m.kind==='ready'));assert.equal(downloads.length,0);dom.window.close();
 const other=bridge();const sheet=other.w.document.createElement('a');sheet.href=other.w.URL.createObjectURL(new other.w.Blob(['PK spreadsheet']));sheet.download='marks.xlsx';
 other.w.document.body.append(sheet);sheet.click();await pause();assert.equal(other.downloads.length,1);assert.equal(other.downloads[0].name,'marks.xlsx');other.dom.window.close();
});
test('vtopDownload-style popups with a CSRF token open the viewer; HTML responses fall back to the popup',async()=>{
 const a=bridge();a.w.open('examinations/getQuestionPaper/12?authorizedID=X&_csrf=test');await pause();
 assert.equal(a.opens.length,0);assert.ok(a.messages.some(m=>m.kind==='ready'));a.dom.window.close();
 const b=bridge({body:'<html>page</html>',type:'text/html'});b.w.open('examinations/getQuestionPaper/12?authorizedID=X&_csrf=test');await pause();
 assert.equal(b.opens.length,1);assert.ok(b.messages.some(m=>m.kind==='not-pdf'));b.dom.window.close();
});
test('Download stays visible during loading, request failure, blob-copy failure and viewer errors',async()=>{
 const {dom,w,shadow,send}=previewWindow();
 send('pdf-1-1','loading');const button=shadow.querySelector('.download');assert.equal(button.hidden,false);
 const controls=[];w.addEventListener('message',event=>{if(event.data?.source==='vtop-command-pdf-control')controls.push(event.data);});
 send('pdf-1-1','error');assert.equal(button.hidden,false);button.click();await pause();
 assert.ok(controls.some(m=>m.kind==='download'&&m.id==='pdf-1-1'));
 w.fetch=async()=>{throw Error('Blob unavailable');};send('pdf-1-1','ready',{blobUrl:'blob:https://vtop.vit.ac.in/missing'});await pause();
 assert.equal(button.hidden,false);assert.match(shadow.querySelector('.status').textContent,/Use Download/);
 w.fetch=async()=>({arrayBuffer:async()=>new TextEncoder().encode('%PDF-1.4').buffer});
 send('pdf-1-1','ready',{blobUrl:'blob:https://vtop.vit.ac.in/valid'});await pause();
 const frame=shadow.querySelector('iframe');const nonce=new URL(frame.src).hash.slice(1);
 w.dispatchEvent(new w.MessageEvent('message',{source:frame.contentWindow,origin:'chrome-extension://test-extension',data:{type:'viewer-error',nonce}}));
 assert.equal(button.hidden,false);assert.equal(shadow.querySelector('dialog').open,true);dom.window.close();
});
test('explicit Download bypasses a failed GET preview and never starts another preview request',async()=>{
 const t=bridge({ok:false});t.w.open('/vtop/download/broken');await pause();
 const id=t.messages.find(m=>m.kind==='loading').id;
 const send=(kind,origin=t.w.location.origin,requestId=id)=>t.w.dispatchEvent(new t.w.MessageEvent('message',{source:t.w,origin,data:{source:'vtop-command-pdf-control',kind,id:requestId}}));
 send('download','https://attacker.example');send('download',t.w.location.origin,'pdf-stale');assert.equal(t.downloads.length,0);
 send('download');assert.equal(t.downloads.length,1);assert.equal(t.downloads[0].href,'https://vtop.vit.ac.in/vtop/download/broken');assert.equal(t.calls.length,1);
 send('release');send('download');assert.equal(t.downloads.length,1);t.dom.window.close();
});
test('explicit Download uses the retained PDF Blob without fetching it again',async()=>{
 const t=bridge();t.w.open('/vtop/download/report');await pause();
 const id=t.messages.find(m=>m.kind==='ready').id;
 t.w.dispatchEvent(new t.w.MessageEvent('message',{source:t.w,origin:t.w.location.origin,data:{source:'vtop-command-pdf-control',kind:'download',id}}));
 assert.equal(t.calls.length,1);assert.equal(t.downloads.length,1);assert.equal(t.downloads[0].name,'Lecture notes.pdf');assert.ok(t.downloads[0].href.startsWith('blob:'));t.dom.window.close();
});
test('POST preview failure never retries automatically; explicit Download submits original fields natively once',async()=>{
 const t=bridge({ok:false});const form=t.w.document.createElement('form');form.method='post';form.action='/vtop/download/report';form.innerHTML='<input name="_csrf" value="mock-token"><input name="course" value="sample">';t.w.document.body.append(form);form.submit();await pause();
 assert.equal(t.calls.length,1);assert.equal(t.calls[0].init.method,'POST');
 const id=t.messages.find(m=>m.kind==='loading').id;const native=[];
 // Capture originalSubmit's receiver through the native form prototype hook set up by bridge().
 const observer=new t.w.MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.tagName==='FORM')native.push(node);});observer.observe(t.w.document.documentElement,{childList:true});
 t.w.dispatchEvent(new t.w.MessageEvent('message',{source:t.w,origin:t.w.location.origin,data:{source:'vtop-command-pdf-control',kind:'download',id}}));await pause();
 assert.equal(t.calls.length,2);assert.equal(t.calls[1].native,true);assert.equal(native.length,1);assert.equal(native[0].querySelector('[name="_csrf"]').value,'mock-token');assert.equal(native[0].querySelector('[name="course"]').value,'sample');assert.equal(native[0].target,'_blank');observer.disconnect();t.dom.window.close();
});
