//! Bounded PDF rasterization for document QA. Uses the same admission and
//! CoreGraphics renderer as the application's existing document viewer.
use serde_json::json;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

fn workspace_path(value: &str, exists: bool) -> Result<PathBuf, String> {
    let cwd = std::env::current_dir()
        .map_err(|_| "workspace unavailable")?
        .canonicalize()
        .map_err(|_| "workspace unavailable")?;
    let path = Path::new(value);
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    if absolute
        .components()
        .any(|p| p == std::path::Component::ParentDir)
    {
        return Err("path must be inside the workspace".into());
    }
    let resolved = if exists {
        absolute.canonicalize().map_err(|_| "input unavailable")?
    } else {
        absolute
            .parent()
            .ok_or("output directory unavailable")?
            .canonicalize()
            .map_err(|_| "output directory unavailable")?
            .join(absolute.file_name().ok_or("output name unavailable")?)
    };
    if !resolved.starts_with(&cwd) {
        return Err("path must be inside the workspace".into());
    }
    Ok(resolved)
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 2 && args.len() != 4 {
        return Err(
            "usage: yijie-document-render inspect INPUT.pdf | page INPUT.pdf PAGE OUTPUT.png"
                .into(),
        );
    }
    let input = workspace_path(&args[1], true)?;
    let mut file = std::fs::File::open(input).map_err(|_| "input unavailable")?;
    let mut bytes = Vec::new();
    (&mut file)
        .take(10 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "input unavailable")?;
    if bytes.is_empty() || bytes.len() > 10 * 1024 * 1024 {
        return Err("PDF source exceeds document limit".into());
    }
    let requested = if args[0] == "page" && args.len() == 4 {
        args[2]
            .parse::<usize>()
            .map_err(|_| "page must be a positive number")?
            .checked_sub(1)
            .ok_or("page must be positive")?
    } else if args[0] == "inspect" && args.len() == 2 {
        0
    } else {
        return Err("unsupported operation".into());
    };
    let (pages, page, image) =
        yijie_desktop_lib::chat::render_document_pdf_for_cli(&bytes, requested)?;
    if requested >= pages {
        return Err("requested page is outside the document".into());
    }
    if args[0] == "page" {
        let output = workspace_path(&args[3], false)?;
        let mut target = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(output)
            .map_err(|_| "output must be a new workspace file")?;
        target
            .write_all(&image)
            .and_then(|_| target.sync_all())
            .map_err(|_| "page could not be saved")?;
    }
    println!("{}", json!({"pages":pages,"page":page+1,"status":"ready"}));
    Ok(())
}

fn main() {
    if let Err(message) = run() {
        eprintln!("{}", json!({"status":"unavailable","message":message}));
        std::process::exit(1);
    }
}
