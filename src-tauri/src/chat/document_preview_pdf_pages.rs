//! Continuous PDF pages with bounded, on-demand native rasterization.
use super::{artifact_native::ArtifactNativeCode as Code, document_preview_pdf};
use std::collections::VecDeque;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

const CACHE_PAGES: usize = 4;
const CACHE_BYTES: usize = 16 * 1024 * 1024;

pub(super) struct PdfPages {
    bytes: Vec<u8>,
    sizes: Vec<(f64, f64)>,
    cache: Mutex<VecDeque<(usize, Vec<u8>)>>,
}

impl PdfPages {
    pub fn new(bytes: &[u8]) -> Result<Self, Code> {
        Ok(Self {
            bytes: bytes.to_vec(),
            sizes: document_preview_pdf::page_sizes(bytes)?,
            cache: Mutex::new(VecDeque::new()),
        })
    }

    pub fn image(&self, index: usize, live: &AtomicBool) -> Result<Vec<u8>, Code> {
        if index >= self.sizes.len() || !live.load(Ordering::Acquire) {
            return Err(Code::NotFound);
        }
        // Serializes raster work as well as keeping the cache bounded. Requests
        // from a retired view cannot spend more raster work or return content.
        let mut cache = self.cache.lock().map_err(|_| Code::Unavailable)?;
        if !live.load(Ordering::Acquire) {
            return Err(Code::NotFound);
        }
        if let Some(position) = cache.iter().position(|(page, _)| *page == index) {
            let entry = cache.remove(position).ok_or(Code::Unavailable)?;
            let bytes = entry.1.clone();
            cache.push_back(entry);
            return Ok(bytes);
        }
        let (_, _, bytes) = document_preview_pdf::render(&self.bytes, index)?;
        if !live.load(Ordering::Acquire) {
            return Err(Code::NotFound);
        }
        if bytes.len() <= CACHE_BYTES {
            while cache.len() >= CACHE_PAGES
                || cache.iter().map(|(_, b)| b.len()).sum::<usize>() + bytes.len() > CACHE_BYTES
            {
                cache.pop_front();
            }
            cache.push_back((index, bytes.clone()));
        }
        Ok(bytes)
    }

    pub fn body(&self) -> String {
        let mut body = self.sizes.iter().enumerate().map(|(index, (width, height))| {
            let page = index + 1;
            format!(r#"<figure class="pdf-page" data-page="{index}" aria-label="第 {page} 页" style="width:{width}px;aspect-ratio:{width}/{height}"><span class="pdf-status">正在加载第 {page} 页…</span><img alt="第 {page} 页" decoding="async"></figure>"#)
        }).collect::<String>();
        // All page placeholders are present from the start, preserving scroll
        // geometry. Only nearby pages hold images; no document-supplied script.
        body.push_str(r#"<script>(()=>{
const pages=[...document.querySelectorAll('.pdf-page')];
let pending=false;
function update(){
 pending=false;const h=innerHeight;
 const nearby=pages.map(p=>({p,r:p.getBoundingClientRect()})).filter(({r})=>r.bottom>=-h&&r.top<=2*h).sort((a,b)=>Math.abs(a.r.top-h/2)-Math.abs(b.r.top-h/2)).slice(0,6);
 const wanted=new Set(nearby.map(({p})=>p));
 for(const p of pages){const img=p.querySelector('img');
  if(wanted.has(p)&&!img.hasAttribute('src')){
   img.onload=()=>{p.classList.add('loaded');};
   img.onerror=()=>{p.querySelector('.pdf-status').textContent='本页暂时无法显示';};
   img.src='yijie-document://preview/pdf/page-'+p.dataset.page+'.png';
  }else if(!wanted.has(p)&&img.hasAttribute('src')){img.removeAttribute('src');p.classList.remove('loaded');}
 }
}
const schedule=()=>{if(!pending){pending=true;requestAnimationFrame(update);}};
addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);addEventListener('load',schedule);schedule();
})();</script>"#);
        body
    }

    #[cfg(test)]
    pub fn cached_pages(&self) -> usize {
        self.cache.lock().unwrap().len()
    }
}

pub(super) const STYLES: &str = ".pdf-page{position:relative;max-width:100%;min-height:80px;margin:0 auto 16px;background:white;color:#767676;overflow:hidden}.pdf-page:last-of-type{margin-bottom:0}.pdf-page img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;margin:0}.pdf-status{position:absolute;inset:0;display:grid;place-items:center;font-size:12px}.pdf-page.loaded .pdf-status{display:none}";
