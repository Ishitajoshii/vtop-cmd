// Runs in VTOP's MAIN world to preserve its authenticated download requests.
(() => {
  'use strict';
  const marker = '__vtopCommandPdfBridge';
  if (window[marker]) return;
  window[marker] = true;
  const originalOpen = window.open;
  const originalClick = HTMLAnchorElement.prototype.click;
  const originalSubmit = HTMLFormElement.prototype.submit;
  const nativeFetch = window.fetch.bind(window);
  const createURL = URL.createObjectURL.bind(URL);
  const revokeURL = URL.revokeObjectURL.bind(URL);
  const pdfBlobs = new Map();
  URL.createObjectURL = function (blob) {
    const url = createURL(blob);
    // Untyped blobs are common for AJAX downloads; preview() sniffs the bytes before showing them.
    // VTOP's downloadFileWithProgress revokes right after click(), so keep the Blob itself for preview().
    if (blob instanceof Blob && /^$|application\/(?:pdf|octet-stream)/i.test(blob.type)) pdfBlobs.set(url,blob);
    return url;
  };
  URL.revokeObjectURL = function (url) { pdfBlobs.delete(url); return revokeURL(url); };
  const nativeURLs = new Set();
  let sequence = 0, activeDownload = null;
  let bypassClick = false;
  let downloadIntent = null;
  const downloadHint = value => /\bpdf\b|download|dwnld|curriculdown/i.test(value || '');
  function localURL(value) {
    try {const url=new URL(value,document.baseURI);return url.origin===location.origin&&url.pathname.startsWith('/vtop/');} catch {return false;}
  }
  function pendingDownload() {return downloadIntent && Date.now()-downloadIntent.time<10000;}
  function controlHint(control) {
    if (!control) return '';
    // Icon-only buttons carry intent in classes such as fa-download or fa-file-pdf.
    const classes = [control,...control.querySelectorAll('[class]')].map(node => node.getAttribute('class'));
    return [control.id,control.name,control.textContent,control.getAttribute('aria-label'),control.getAttribute('title'),control.value,...classes].filter(Boolean).join(' ');
  }
  function candidate(value) {
    try {
      const url = new URL(value, document.baseURI);
      return url.origin === location.origin && url.pathname.startsWith('/vtop/') &&
        /\.pdf$|download|dwnld|curriculdown|viewfile/i.test(decodeURIComponent(url.pathname));
    } catch { return false; }
  }
  function filename(header, fallback = 'document.pdf') {
    const encoded = header?.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
    const plain = header?.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
    let name = encoded || plain?.[1] || plain?.[2] || fallback;
    try { if (encoded) name = decodeURIComponent(name); } catch {}
    return name.replace(/[\\/\x00-\x1f]/g, '_').trim().slice(0,180) || fallback;
  }
  function emit(kind, id, extra = {}) { window.postMessage({ source: 'vtop-command-pdf', kind, id, ...extra }, location.origin); }
  function download(blob, name) {
    const url = createURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.dataset.vtopPdfBypass = 'true'; nativeURLs.add(url);
    document.documentElement.append(anchor); originalClick.call(anchor); anchor.remove();
    setTimeout(() => { nativeURLs.delete(url); revokeURL(url); },60000);
  }
  function originalDownload(url, init, name) {
    const method=(init?.method || 'GET').toUpperCase();
    nativeURLs.add(url);setTimeout(()=>nativeURLs.delete(url),10000);
    if(method==='POST'){
      // A fresh native request happens only after the user explicitly presses Download.
      const form=document.createElement('form');form.method='POST';form.action=url;form.target='_blank';
      form.enctype=init.body instanceof FormData?'multipart/form-data':'application/x-www-form-urlencoded';
      for(const [key,value] of init.body || []){
        if(typeof value!=='string')throw new Error('Original download is unavailable. Retry its link.');
        const input=document.createElement('input');input.type='hidden';input.name=key;input.value=value;form.append(input);
      }
      document.documentElement.append(form);
      try{originalSubmit.call(form);}finally{form.remove();}
    }else{
      const anchor=document.createElement('a');anchor.href=url;anchor.download=name||'document.pdf';anchor.target='_blank';
      anchor.dataset.vtopPdfBypass='true';document.documentElement.append(anchor);
      try{originalClick.call(anchor);}finally{anchor.remove();}
    }
  }
  window.addEventListener('message',event=>{
    const message=event.data;
    if(event.source!==window||event.origin!==location.origin||message?.source!=='vtop-command-pdf-control'||message.id!==activeDownload?.id)return;
    if(message.kind==='release'){activeDownload=null;return;}
    if(message.kind==='download'){
      try{activeDownload.save();}catch{emit('download-error',message.id);}
    }
  });
  async function preview(url, init, suggestedName, fallback, source) {
    downloadIntent=null;
    const id = `pdf-${Date.now()}-${++sequence}`;
    activeDownload={id,save:()=>source?download(source,suggestedName||'document.pdf'):originalDownload(url,init,suggestedName)};
    emit('loading',id);
    try {
      const response = source ? null : await nativeFetch(url,{credentials:'same-origin',...init});
      if (response && !response.ok) throw new Error('The document could not be loaded. Your VTOP session may have expired.');
      const blob = source || await response.blob();
      const signature = new Uint8Array(await blob.slice(0,5).arrayBuffer());
      const isPdf = signature.length === 5 && String.fromCharCode(...signature) === '%PDF-';
      const name = filename(response?.headers.get('content-disposition'), suggestedName || (isPdf ? 'document.pdf' : 'download'));
      if (!isPdf) {
        if (fallback && /text\/html/i.test(blob.type)) { emit('not-pdf',id); fallback(); return; }
        if (/text\/html|application\/json/i.test(blob.type)) throw new Error('VTOP returned a page instead of a document. Sign in again and retry.');
        download(blob,name); emit('not-pdf',id); return;
      }
      if(activeDownload?.id===id)activeDownload.save=()=>download(blob,name);
      const blobUrl = createURL(new Blob([blob],{type:'application/pdf'}));
      emit('ready',id,{blobUrl,filename:name});
      setTimeout(() => revokeURL(blobUrl),60000);
    } catch (error) { emit('error',id,{message:error.message || 'Unable to preview this document.'}); }
  }
  function handleAnchor(anchor) {
    if (bypassClick || anchor.dataset.vtopPdfBypass === 'true') return false;
    const rawHref=anchor.getAttribute('href')||'';
    // Menu entries and JavaScript helpers must run their native handlers first.
    if(!rawHref||/^\s*(?:#|javascript:)/i.test(rawHref)||anchor.matches('.systemB5BtnMenu,.systemBtnMenu,.quickB5MainMenu,[data-bs-toggle]'))return false;
    const url = anchor.href;
    const isBlob = url.startsWith(`blob:${location.origin}/`) && (anchor.hasAttribute('download') || pdfBlobs.has(url));
    const isDataPdf=/^data:application\/pdf(?:[;,])/i.test(url);
    const explicitFile=localURL(url)&&(anchor.hasAttribute('download')||anchor.type==='application/pdf'||downloadHint(controlHint(anchor)));
    if (!candidate(url) && !isBlob && !isDataPdf && !explicitFile) return false;
    preview(url,undefined,anchor.download || undefined,undefined,pdfBlobs.get(url)); return true;
  }
  // vtopDownload() opens `<endpoint>?authorizedID=…&_csrf=…`; a CSRF token in a popup URL marks a download.
  const tokenURL = value => { try { return new URL(value,document.baseURI).searchParams.has('_csrf'); } catch { return false; } };
  window.open = function (url, ...args) {
    if (!bypassClick && (candidate(url) || pdfBlobs.has(url) || /^data:application\/pdf(?:[;,])/i.test(String(url)) || localURL(url)&&(pendingDownload()||tokenURL(url)))) {
      const href = new URL(url,document.baseURI).href;
      // Only the token heuristic may be wrong about a page; known download endpoints keep the session-expired error.
      const fallback = candidate(url) || pdfBlobs.has(href) ? undefined : () => originalOpen.call(window,href,...args);
      preview(href,undefined,undefined,fallback,pdfBlobs.get(href)); return null;
    }
    return originalOpen.call(this,url,...args);
  };
  HTMLAnchorElement.prototype.click = function (...args) {
    if (!handleAnchor(this)) return originalClick.apply(this,args);
  };
  // FileSaver-style helpers dispatch a synthetic click on a detached anchor, which the document listener never sees.
  const nativeDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (event) {
    if (this instanceof HTMLAnchorElement && !this.isConnected && event?.type === 'click' &&
      !(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) && handleAnchor(this)) return false;
    return nativeDispatch.call(this,event);
  };
  document.addEventListener('click',event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      downloadIntent=null;bypassClick=true;setTimeout(()=>{bypassClick=false;},0);return;
    }
    const control=event.target.closest?.('button,a,input[type="button"],input[type="submit"],[role="button"]');
    downloadIntent=downloadHint(controlHint(control))?{time:Date.now()}:null;
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = event.target.closest?.('a[href]');
    if (anchor && handleAnchor(anchor)) { event.preventDefault(); event.stopImmediatePropagation(); }
  },true);
  function handleForm(form, submitter) {
    if(bypassClick)return false;
    const url = new URL(submitter?.getAttribute('formaction') || form.action,document.baseURI);
    const intendedDownload=downloadHint(`${form.id} ${form.name} ${controlHint(submitter)}`)||pendingDownload();
    if (!localURL(url.href) || (!candidate(url.href)&&!intendedDownload) || form.querySelector('input[type=file]')) return false;
    const method = (submitter?.getAttribute('formmethod') || form.method || 'get').toUpperCase();
    if (!['GET','POST'].includes(method)) return false;
    const fields = new FormData(form);
    if (submitter?.name) fields.append(submitter.name,submitter.value);
    const params = new URLSearchParams(fields);
    if (method === 'GET') { for (const [key,value] of params) url.searchParams.append(key,value); preview(url.href); }
    else if (form.enctype === 'multipart/form-data') preview(url.href,{method,body:fields});
    else if (form.enctype === 'application/x-www-form-urlencoded') preview(url.href,{method,body:params});
    else return false;
    return true;
  }
  // Catch-all for location.href/assign, native form submissions and downloads the hooks above cannot see.
  // Read-only POST downloads are never replayed automatically. A native POST retry requires the user
  // to press Download explicitly; only GET navigations fall back to the native page automatically.
  window.navigation?.addEventListener?.('navigate',event => {
    if (bypassClick || !event.cancelable || event.hashChange || ['reload','traverse'].includes(event.navigationType)) return;
    const url = event.destination?.url;
    if (!url || nativeURLs.has(url) || [...(event.formData?.values() || [])].some(value => typeof value !== 'string')) return;
    const isDownload = event.downloadRequest != null;
    const isBlob = url.startsWith(`blob:${location.origin}/`) && (isDownload || pdfBlobs.has(url));
    const isDataPdf = /^data:application\/pdf(?:[;,])/i.test(url);
    const fields = event.formData;
    if (fields ? !candidate(url) : !candidate(url) && !isBlob && !isDataPdf && !(localURL(url) && (isDownload || pendingDownload()))) return;
    event.preventDefault();
    preview(url,fields ? {method:'POST',body:fields} : undefined,event.downloadRequest || undefined,fields ? undefined : () => {
      // A GET that merely looks like a download is opened natively instead of being shown as an error.
      nativeURLs.add(url); setTimeout(() => nativeURLs.delete(url),10000); location.assign(url);
    });
  });
  HTMLFormElement.prototype.submit = function (...args) { if (!handleForm(this)) return originalSubmit.apply(this,args); };
  document.addEventListener('submit',event=>{
    if (!event.defaultPrevented && handleForm(event.target,event.submitter)) {event.preventDefault();event.stopImmediatePropagation();}
  },true);
})();
