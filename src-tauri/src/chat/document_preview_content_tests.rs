//! Normal, locally generated documents only. No attack or fault fixtures.
use super::*;
use std::io::Write;

fn office(kind: &str, entries: &[(&str, &[u8])]) -> Vec<u8> {
    let (main, content_type) = match kind {
        "docx" => (
            "word/document.xml",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        ),
        "pptx" => (
            "ppt/presentation.xml",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
        ),
        _ => (
            "xl/workbook.xml",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        ),
    };
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    zip.start_file("[Content_Types].xml", options).unwrap();
    write!(zip, "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Override PartName=\"/{main}\" ContentType=\"{content_type}\"/></Types>").unwrap();
    for (name, bytes) in entries {
        zip.start_file(*name, options).unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

#[test]
fn normal_docx_preserves_headings_lists_tables_pictures_and_entities() {
    let image = attachment::test_image_bytes("png");
    let bytes = office("docx", &[
        ("word/document.xml", br#"<w:document xmlns:w="urn:w" xmlns:r="urn:r" xmlns:a="urn:a"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Normal &amp; readable</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>List entry</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell value</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:drawing><a:blip r:embed="image1"/></w:drawing></w:r></w:p></w:body></w:document>"#),
        ("word/numbering.xml", br#"<w:numbering xmlns:w="urn:w"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>"#),
        ("word/_rels/document.xml.rels", br#"<Relationships><Relationship Id="image1" Target="media/picture.png"/></Relationships>"#),
        ("word/media/picture.png", &image),
    ]);
    let p = render(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        &bytes,
        0,
        0,
        false,
        1.0,
    )
    .unwrap();
    assert!(p.html.contains("<h2>Normal &amp; readable</h2>"));
    assert!(p.html.contains("•&nbsp; List entry"));
    assert!(p.html.contains("Cell value"));
    assert_eq!(p.assets.len(), 1);
    assert!(!p.partial);
}

#[test]
fn normal_pptx_uses_relationship_order_instead_of_filename_sort() {
    let image = attachment::test_image_bytes("png");
    let bytes=office("pptx", &[
        ("ppt/presentation.xml", br#"<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst><p:sldId r:id="second" id="256"/><p:sldId r:id="first" id="257"/></p:sldIdLst></p:presentation>"#),
        ("ppt/_rels/presentation.xml.rels", br#"<Relationships><Relationship Id="first" Target="slides/slide2.xml"/><Relationship Id="second" Target="slides/slide10.xml"/></Relationships>"#),
        ("ppt/slides/slide10.xml", br#"<p:sld xmlns:p="urn:p" xmlns:a="urn:a" xmlns:r="urn:r"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>First displayed slide</a:t></a:r></a:p></p:txBody></p:sp><p:pic><a:blip r:embed="picture"/></p:pic></p:spTree></p:cSld></p:sld>"#),
        ("ppt/slides/_rels/slide10.xml.rels", br#"<Relationships><Relationship Id="picture" Target="../media/picture.png"/></Relationships>"#),
        ("ppt/media/picture.png", &image),
        ("ppt/slides/slide2.xml", br#"<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Second displayed slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"#),
    ]);
    let mime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    let p = render(mime, &bytes, 0, 0, false, 1.0).unwrap();
    assert!(p.html.contains("First displayed slide"));
    assert_eq!(p.assets.len(), 1);
    assert_eq!(p.sections.len(), 2);
    let p = render(mime, &bytes, 1, 0, true, 1.5).unwrap();
    assert!(p.html.contains("Second displayed slide"));
    assert!(!p.html.contains("First displayed"));
}

#[test]
fn normal_xlsx_renders_cells_merges_shared_strings_and_cached_formulas() {
    let bytes=office("xlsx", &[
        ("xl/workbook.xml", br#"<workbook xmlns:r="urn:r"><sheets><sheet name="Summary" sheetId="1" r:id="sheet"/></sheets></workbook>"#),
        ("xl/_rels/workbook.xml.rels", br#"<Relationships><Relationship Id="sheet" Target="worksheets/sheet1.xml"/></Relationships>"#),
        ("xl/sharedStrings.xml", b"<sst><si><t>Real cell</t></si></sst>"),
        ("xl/styles.xml", b"<styleSheet><cellXfs><xf numFmtId='0'/><xf numFmtId='14'/><xf numFmtId='10'/></cellXfs></styleSheet>"),
        ("xl/worksheets/sheet1.xml", b"<worksheet><sheetData><row r='1'><c r='A1' t='s'><v>0</v></c><c r='C1' s='2'><v>0.25</v></c></row><row r='3'><c r='A3' s='1'><v>1</v></c><c r='B3'><f>1+2</f><v>3</v></c><c r='C3'><f>2+2</f></c></row></sheetData><mergeCells><mergeCell ref='A1:B2'/></mergeCells></worksheet>"),
    ]);
    let p = render(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        &bytes,
        0,
        0,
        false,
        1.0,
    )
    .unwrap();
    assert_eq!(p.sections[0].label, "Summary");
    assert!(p.html.contains("rowspan=\"2\" colspan=\"2\">Real cell"));
    for text in [
        "25.00%",
        "1900-01-01",
        ">3</td>",
        "=2+2（无已保存计算结果）",
        "<tr><th>2</th>",
    ] {
        assert!(p.html.contains(text), "missing {text}");
    }
    assert!(!p.partial);
}

#[test]
fn normal_docx_long_body_has_bounded_continuation_and_blank_page_is_readable() {
    let paragraphs = (0..2000)
        .map(|i| {
            format!(
                "<w:p><w:r><w:t>Paragraph {i}: {}</w:t></w:r></w:p>",
                "ordinary text ".repeat(20)
            )
        })
        .collect::<String>();
    let doc = format!("<w:document xmlns:w='urn:w'><w:body>{paragraphs}</w:body></w:document>");
    let bytes = office("docx", &[("word/document.xml", doc.as_bytes())]);
    let mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    let p = render(mime, &bytes, 0, 0, false, 1.0).unwrap();
    assert!(p.next.is_some());
    assert!(p.html.len() < TEXT_BUDGET + 4096);
    let next = render(mime, &bytes, 0, p.next.unwrap(), false, 1.0).unwrap();
    assert!(next.offset > 0);
    assert!(next.previous.is_some());
    let bytes = office(
        "docx",
        &[(
            "word/document.xml",
            b"<w:document xmlns:w='urn:w'><w:body/></w:document>",
        )],
    );
    assert!(render(mime, &bytes, 0, 0, false, 1.0)
        .unwrap()
        .html
        .contains("没有可显示的正文"));
}

#[cfg(target_os = "macos")]
#[test]
fn normal_pdf_raster_has_correct_orientation_and_real_graphical_content() {
    use pdf_extract::{Dictionary, Document, Object, Stream};
    let mut pdf = Document::with_version("1.4");
    pdf.reference_table.cross_reference_type = pdf_extract::xref::XrefType::CrossReferenceTable;
    let pages_id = pdf.new_object_id();
    let content = pdf.add_object(Stream::new(
        Dictionary::new(),
        b"1 0 0 rg 0 80 20 20 re f 0 0 1 rg 80 0 20 20 re f".to_vec(),
    ));
    let mut page = Dictionary::new();
    page.set("Type", "Page");
    page.set("Parent", pages_id);
    page.set("Contents", content);
    page.set("MediaBox", vec![0.into(), 0.into(), 100.into(), 100.into()]);
    page.set("Resources", Dictionary::new());
    let page_id = pdf.add_object(page);
    let mut pages = Dictionary::new();
    pages.set("Type", "Pages");
    pages.set("Kids", vec![Object::Reference(page_id)]);
    pages.set("Count", 1);
    pdf.objects.insert(pages_id, Object::Dictionary(pages));
    let mut catalog = Dictionary::new();
    catalog.set("Type", "Catalog");
    catalog.set("Pages", pages_id);
    let root = pdf.add_object(catalog);
    pdf.trailer.set("Root", root);
    let mut bytes = vec![];
    pdf.save_to(&mut bytes).unwrap();
    attachment::validate_pdf_artifact_content(&bytes).unwrap();
    let p = render("application/pdf", &bytes, 0, 0, false, 1.0).unwrap();
    assert_eq!(p.sections.len(), 1);
    let image = image::load_from_memory(&p.assets["image/page.png"])
        .unwrap()
        .to_rgba8();
    assert_eq!(image.get_pixel(10, 10).0, [255, 0, 0, 255]);
    assert_eq!(image.get_pixel(190, 190).0, [0, 0, 255, 255]);
}

#[test]
fn html_keeps_rendering_script_source_and_text_reuses_existing_projection() {
    let html=b"<!doctype html><p id='value'></p><script>document.getElementById('value').textContent='Normal rendered content';</script>";
    let p = render("text/html", html, 0, 0, false, 1.0).unwrap();
    assert_eq!(p.html.as_bytes(), html);
    assert_eq!(p.kind, "html");
    let p = render("text/plain", b"normal & readable", 0, 0, true, 1.0).unwrap();
    assert!(p.html.contains("normal &amp; readable"));
    assert!(!p.partial);
}
