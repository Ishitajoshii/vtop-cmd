(() => {
  'use strict';
  if (document.getElementById('vtop-pdf-preview')) return;
  const host=document.createElement('div');host.id='vtop-pdf-preview';
  const shadow=host.attachShadow({mode:'open'});
  const { logo, tokens, font, shortcut } = globalThis.VtopBrand;
  // Same surface, header and button language as the command menu (content.js).
  shadow.innerHTML=`<style>
    :host{all:initial;color-scheme:light;${tokens.light};font:${font};color:var(--text)}
    :host([data-dark]){color-scheme:dark;${tokens.dark}}
    *{box-sizing:border-box}
    dialog{padding:0;margin:auto;width:min(1200px,calc(100vw - 28px));height:calc(100vh - 48px);max-width:none;max-height:none;border:1px solid var(--line);border-radius:20px;background:var(--surface);color:var(--text);box-shadow:0 24px 100px #0005;overflow:hidden}
    dialog[open]{display:flex;flex-direction:column}
    dialog::backdrop{background:#10182788;backdrop-filter:blur(5px)}
    header{display:flex;gap:12px;align-items:center;padding:16px 22px 14px}
    .brand{display:flex;align-items:center;gap:9px;flex-shrink:0;font-size:11px;font-weight:750;letter-spacing:2px;color:var(--muted)}.logo{display:block;flex-shrink:0;width:24px;height:24px}
    h2{margin:0 0 0 6px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:550}
    .download,.close{font:inherit;font-size:12px;border:1px solid var(--line);border-radius:8px;color:var(--muted);background:transparent;padding:5px 8px;text-decoration:none;cursor:pointer;white-space:nowrap}
    .download:hover,.close:hover{background:var(--hover);color:var(--text)}
    :is(.download,.close):focus-visible{outline:2px solid var(--accent);outline-offset:3px}
    [hidden]{display:none!important}
    .status{padding:12px 22px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}.status:empty{display:none}
    iframe{display:block;width:100%;flex:1;min-height:0;border:0;background:var(--surface)}
    @media(max-width:480px){.brand-text{display:none}header{padding:12px 14px}}
    @media(prefers-reduced-motion:no-preference){dialog[open]{animation:arrive .13s ease-out}@keyframes arrive{from{transform:translateY(-8px);opacity:0}to{transform:translateY(0);opacity:1}}}
  </style><dialog aria-label="PDF preview"><header><span class="brand">${logo}<span class="brand-text">VTOP / PDF</span></span><h2>PDF preview</h2><a class="download" hidden>Download</a><button class="close" type="button" aria-label="Close PDF preview">Esc</button></header><div class="status" role="status" aria-live="polite"></div></dialog>`;
  document.documentElement.append(host);
  const dialog=shadow.querySelector('dialog'),status=shadow.querySelector('.status'),download=shadow.querySelector('.download');
  const viewerURL=chrome.runtime.getURL('pdf-viewer.html');
  const parsedViewerURL=new URL(viewerURL);
  const viewerOrigin=parsedViewerURL.protocol==='chrome-extension:' ? `chrome-extension://${parsedViewerURL.host}` : parsedViewerURL.origin;
  let activeId,blobURL,previousFocus,nonce,bytes,filename,frame,received,watchdog,dark=false;
  function setTheme(value){dark=value;host.toggleAttribute('data-dark',dark);}
  try {
    chrome.storage.local.get('darkMode').then(settings=>setTheme(settings.darkMode===true)).catch(()=>{});
    chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.darkMode)setTheme(changes.darkMode.newValue===true);});
  } catch { /* Preview without the extension runtime. */ }
  function release(){ clearTimeout(watchdog);if(blobURL)URL.revokeObjectURL(blobURL);blobURL=null;bytes=null;frame?.remove();frame=null;download.removeAttribute('href');download.hidden=true; }
  function deliver(){ if(bytes&&frame?.contentWindow&&!received)frame.contentWindow.postMessage({type:'pdf-data',nonce,bytes:bytes.slice(0),filename},viewerOrigin); }
  // A new frame per document: reusing one turns viewer#a → viewer#b into a hash-only navigation that never reloads.
  function mount(){
    nonce=crypto.randomUUID();received=false;
    frame=document.createElement('iframe');frame.title='PDF document viewer';frame.addEventListener('load',deliver);
    // The theme rides along in the URL so the viewer paints in the right colours from the first frame.
    frame.src=`${viewerURL}?theme=${dark?'dark':'light'}#${nonce}`;dialog.append(frame);
    watchdog=setTimeout(()=>{status.textContent='The viewer did not respond. Use Download to save the PDF, or retry the link.';},15000);
  }
  function control(kind,id=activeId){if(id)window.postMessage({source:'vtop-command-pdf-control',kind,id},location.origin);}
  download.addEventListener('click',event=>{event.preventDefault();control('download');});
  function close(){if(dialog.open)dialog.close();}
  shadow.querySelector('.close').addEventListener('click',close);
  // A click on the backdrop (outside the dialog box) closes it, like the command menu.
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();});
  dialog.addEventListener('close',()=>{control('release');activeId=null;release();if(previousFocus?.isConnected)previousFocus.focus();});
  function show(id){
    if(!dialog.open){previousFocus=document.activeElement;dialog.showModal();}
    activeId=id;release();download.hidden=false;download.href='#';download.removeAttribute('download');shadow.querySelector('h2').textContent='PDF preview';status.textContent='Loading PDF…';
  }
  window.addEventListener('message',async event=>{
    if(frame && event.source===frame.contentWindow){
      if(event.origin!==viewerOrigin || event.data?.nonce!==nonce)return;
      const type=event.data?.type;
      if(type==='viewer-ready')deliver();
      else if(type==='viewer-received')received=true;
      else if(type==='viewer-loaded'||type==='viewer-error'){clearTimeout(watchdog);status.textContent='';}
      // Keys pressed inside the viewer frame never reach this document; the viewer forwards them.
      else if(type==='viewer-key'&&event.data.key==='Escape')close();
      else if(type==='viewer-key'&&event.data.key==='k'){
        close();document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',metaKey:shortcut.mac,ctrlKey:!shortcut.mac,bubbles:true,cancelable:true}));
      }
      return;
    }
    const message=event.data;
    if(event.source!==window || event.origin!==location.origin || message?.source!=='vtop-command-pdf' || typeof message.id!=='string' || !/^pdf-\d+-\d+$/.test(message.id))return;
    if(message.kind==='loading'){show(message.id);return;}
    if(message.id!==activeId)return;
    if(message.kind==='not-pdf'){close();return;}
    if(message.kind==='error'){status.textContent='Unable to preview this document. Use Download to try the original file; sign in again if needed.';return;}
    if(message.kind==='download-error'){status.textContent='The original download is unavailable. Retry its link or sign in again.';return;}
    if(message.kind!=='ready' || typeof message.blobUrl!=='string' || !message.blobUrl.startsWith(`blob:${location.origin}/`))return;
    const id=message.id;
    try{
      const response=await fetch(message.blobUrl);const data=await response.arrayBuffer();
      if(id!==activeId || !dialog.open)return;
      if(new TextDecoder().decode(data.slice(0,5))!=='%PDF-')throw new Error('Not PDF');
      filename=String(message.filename||'document.pdf').replace(/[\\/\x00-\x1f]/g,'_').slice(0,180);
      bytes=data;blobURL=URL.createObjectURL(new Blob([data],{type:'application/pdf'}));
      download.href=blobURL;download.download=filename;download.hidden=false;
      shadow.querySelector('h2').textContent=filename;
      status.textContent='';mount();
    }catch{if(id===activeId)status.textContent='Unable to open this PDF. Use Download to save the original file, or retry its link.';}
  });
  // Shortcut stays usable without placing the command menu behind an open preview.
  document.addEventListener('keydown',event=>{if(dialog.open&&shortcut.matches(event))close();},true);
})();
