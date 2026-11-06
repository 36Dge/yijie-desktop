use pulldown_cmark::{html, Event, Options, Parser, Tag, TagEnd};

pub(super) fn page(text: &str, dark: bool, zoom: f64) -> String {
    let options =
        Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS;
    let events = Parser::new_ext(text, options)
        .flat_map(read_only_events)
        .flatten();
    let mut body = String::from("<article class=\"markdown-document\">");
    html::push_html(&mut body, events);
    body.push_str("</article>");
    super::styled_page(
        &body,
        dark,
        zoom,
        include_str!("document_preview_markdown.css"),
    )
}

fn read_only_events(event: Event<'_>) -> [Option<Event<'_>>; 2] {
    // Only markup from the parser or the fixed tags below enters the reader.
    // Keep the labels of links and images without resolving their destinations.
    let event = match event {
        Event::Html(text) | Event::InlineHtml(text) => Event::Text(text),
        Event::Start(Tag::Link { .. }) => Event::InlineHtml("<span class=\"md-reference\">".into()),
        Event::Start(Tag::Image { .. }) => Event::InlineHtml("<span>".into()),
        Event::End(TagEnd::Link | TagEnd::Image) => Event::InlineHtml("</span>".into()),
        start @ Event::Start(Tag::Table(_)) => {
            return [
                Some(Event::Html("<div class=\"md-table\">".into())),
                Some(start),
            ];
        }
        end @ Event::End(TagEnd::Table) => {
            return [Some(end), Some(Event::Html("</div>".into()))];
        }
        other => other,
    };
    [Some(event), None]
}
