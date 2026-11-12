//! A continuous reader over the existing bounded, read-only content adapters.
//! Source bytes stay in Native; only the isolated generated reader receives
//! chunks. Neither document HTML nor the main chat WebView gets this bridge.
use super::{escape, render_chunk, Code, Presentation};
use serde::Serialize;
use std::collections::{BTreeMap, VecDeque};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

const CACHE_PAGES: usize = 4;
const CACHE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy)]
struct Cursor {
    section: usize,
    offset: usize,
}

#[derive(Clone, Serialize)]
pub(crate) struct Page {
    pub index: usize,
    pub html: String,
    pub more: bool,
}

struct Chunk {
    page: Page,
    assets: BTreeMap<String, Vec<u8>>,
    next: Option<Cursor>,
}
impl Chunk {
    fn new(p: Presentation, index: usize) -> Result<Self, Code> {
        let next = p
            .next
            .map(|offset| Cursor {
                section: p.section,
                offset,
            })
            .or_else(|| {
                (p.section + 1 < p.sections.len()).then_some(Cursor {
                    section: p.section + 1,
                    offset: 0,
                })
            });
        let body = p
            .html
            .split_once("<body>")
            .and_then(|(_, body)| body.rsplit_once("</body>").map(|(body, _)| body))
            .ok_or(Code::IntegrityFailed)?;
        let mut html = String::new();
        if p.offset == 0 {
            if let Some(section) = p.sections.get(p.section) {
                html.push_str(&format!("<h2>{}</h2>", escape(&section.label)));
            }
        }
        html.push_str(&body.replace(
            "src=\"yijie-document://preview/image/",
            &format!("src=\"yijie-document://preview/chunk/{index}/image/"),
        ));
        if p.partial {
            html.push_str("<p class=\"notice\">部分内容预览：存在截断或未呈现对象</p>");
        }
        Ok(Self {
            page: Page {
                index,
                html,
                more: next.is_some(),
            },
            assets: p.assets,
            next,
        })
    }
    fn size(&self) -> usize {
        self.page.html.len() + self.assets.values().map(Vec::len).sum::<usize>()
    }
}

struct State {
    cursors: Vec<Cursor>,
    cache: VecDeque<Chunk>,
}
impl State {
    fn remember(&mut self, chunk: Chunk) {
        if chunk.size() > CACHE_BYTES {
            return;
        }
        self.cache
            .retain(|entry| entry.page.index != chunk.page.index);
        while self.cache.len() >= CACHE_PAGES
            || self.cache.iter().map(Chunk::size).sum::<usize>() + chunk.size() > CACHE_BYTES
        {
            self.cache.pop_front();
        }
        self.cache.push_back(chunk);
    }
}

pub(crate) struct ContentPages {
    mime: String,
    bytes: Vec<u8>,
    dark: bool,
    zoom: f64,
    state: Mutex<State>,
}
impl ContentPages {
    pub(super) fn wrap(
        mime: &str,
        bytes: &[u8],
        dark: bool,
        zoom: f64,
        mut p: Presentation,
    ) -> Result<Presentation, Code> {
        if matches!(p.kind, "pdf" | "html" | "image" | "video") {
            return Ok(p);
        }
        let shell = p
            .html
            .split_once("<body>")
            .ok_or(Code::IntegrityFailed)?
            .0
            .to_owned();
        let kind = p.kind;
        let partial = p.partial;
        let first = Chunk::new(p, 0)?;
        let mut cursors = vec![Cursor {
            section: 0,
            offset: 0,
        }];
        if let Some(next) = first.next {
            cursors.push(next);
        }
        let html = format!("{shell}<body><main id=\"document-pages\"><article class=\"document-page\" data-index=\"0\" data-state=\"ready\" data-more=\"{}\">{}</article></main><p id=\"document-stream-status\" class=\"notice\" role=\"status\"></p><style>.document-page{{display:flow-root;overflow-x:auto;margin:0 0 20px}}.document-page[data-state=unloaded]{{min-height:75vh}}.document-page:last-child{{margin-bottom:0}}</style><script>{}</script></body></html>", first.page.more, first.page.html, include_str!("document_preview_continuous.js"));
        let mut state = State {
            cursors,
            cache: VecDeque::new(),
        };
        state.remember(first);
        p = Presentation {
            kind,
            html,
            assets: BTreeMap::new(),
            pdf: None,
            continuous: Some(Arc::new(Self {
                mime: mime.to_owned(),
                bytes: bytes.to_vec(),
                dark,
                zoom,
                state: Mutex::new(state),
            })),
            sections: vec![],
            section: 0,
            offset: 0,
            next: None,
            previous: None,
            partial,
        };
        Ok(p)
    }

    fn with_chunk<T>(
        &self,
        index: usize,
        live: &AtomicBool,
        read: impl FnOnce(&Chunk) -> Result<T, Code>,
    ) -> Result<T, Code> {
        if !live.load(Ordering::Acquire) {
            return Err(Code::NotFound);
        }
        // One bounded render at a time, with the same budgets as the previous
        // selected-page reader. Only discovered next cursors can be requested.
        let mut state = self.state.lock().map_err(|_| Code::Unavailable)?;
        if !live.load(Ordering::Acquire) {
            return Err(Code::NotFound);
        }
        if let Some(position) = state
            .cache
            .iter()
            .position(|entry| entry.page.index == index)
        {
            let chunk = state.cache.remove(position).ok_or(Code::Unavailable)?;
            let result = read(&chunk);
            state.cache.push_back(chunk);
            return if live.load(Ordering::Acquire) {
                result
            } else {
                Err(Code::NotFound)
            };
        }
        let cursor = *state.cursors.get(index).ok_or(Code::NotFound)?;
        let chunk = Chunk::new(
            render_chunk(
                &self.mime,
                &self.bytes,
                cursor.section,
                cursor.offset,
                self.dark,
                self.zoom,
            )?,
            index,
        )?;
        if !live.load(Ordering::Acquire) {
            return Err(Code::NotFound);
        }
        if index + 1 == state.cursors.len() {
            if let Some(next) = chunk.next {
                state.cursors.push(next);
            }
        }
        let result = read(&chunk);
        state.remember(chunk);
        result
    }
    pub fn page(&self, index: usize, live: &AtomicBool) -> Result<Page, Code> {
        self.with_chunk(index, live, |chunk| Ok(chunk.page.clone()))
    }
    pub fn image(&self, index: usize, key: &str, live: &AtomicBool) -> Result<Vec<u8>, Code> {
        self.with_chunk(index, live, |chunk| {
            chunk.assets.get(key).cloned().ok_or(Code::NotFound)
        })
    }
    #[cfg(test)]
    pub fn cache_usage(&self) -> (usize, usize) {
        let state = self.state.lock().unwrap();
        (state.cache.len(), state.cache.iter().map(Chunk::size).sum())
    }
}
