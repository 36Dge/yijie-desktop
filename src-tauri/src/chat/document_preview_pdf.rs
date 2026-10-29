//! The system PDF page renderer, used only on already-admitted in-memory bytes.
//! No PDF application, URL, external process, Javascript or document actions.
use super::artifact_native::ArtifactNativeCode as Code;

#[cfg(not(target_os = "macos"))]
pub(super) fn render(_: &[u8], _: usize) -> Result<(usize, usize, Vec<u8>), Code> {
    Err(Code::Unsupported)
}

#[cfg(target_os = "macos")]
pub(super) fn render(bytes: &[u8], index: usize) -> Result<(usize, usize, Vec<u8>), Code> {
    use std::ffi::c_void;
    use std::io::Cursor;
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Point {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Size {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Rect {
        origin: Point,
        size: Size,
    }
    #[repr(C)]
    struct Transform {
        a: f64,
        b: f64,
        c: f64,
        d: f64,
        tx: f64,
        ty: f64,
    }
    type Ref = *mut c_void;
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGDataProviderCreateWithData(
            info: Ref,
            data: *const c_void,
            size: usize,
            release: Option<unsafe extern "C" fn(Ref, *const c_void, usize)>,
        ) -> Ref;
        fn CGDataProviderRelease(value: Ref);
        fn CGPDFDocumentCreateWithProvider(provider: Ref) -> Ref;
        fn CGPDFDocumentRelease(value: Ref);
        fn CGPDFDocumentGetNumberOfPages(value: Ref) -> usize;
        fn CGPDFDocumentGetPage(value: Ref, page: usize) -> Ref;
        fn CGPDFPageGetBoxRect(value: Ref, box_type: i32) -> Rect;
        fn CGPDFPageGetRotationAngle(value: Ref) -> i32;
        fn CGPDFPageGetDrawingTransform(
            value: Ref,
            box_type: i32,
            rect: Rect,
            rotate: i32,
            preserve: bool,
        ) -> Transform;
        fn CGColorSpaceCreateDeviceRGB() -> Ref;
        fn CGColorSpaceRelease(value: Ref);
        fn CGBitmapContextCreate(
            data: Ref,
            width: usize,
            height: usize,
            bits: usize,
            row_bytes: usize,
            colors: Ref,
            bitmap_info: u32,
        ) -> Ref;
        fn CGContextRelease(value: Ref);
        fn CGContextSetRGBFillColor(value: Ref, r: f64, g: f64, b: f64, a: f64);
        fn CGContextFillRect(value: Ref, rect: Rect);
        fn CGContextScaleCTM(value: Ref, x: f64, y: f64);
        fn CGContextConcatCTM(value: Ref, transform: Transform);
        fn CGContextDrawPDFPage(value: Ref, page: Ref);
    }
    struct Owned(Ref, unsafe extern "C" fn(Ref));
    impl Drop for Owned {
        fn drop(&mut self) {
            unsafe { (self.1)(self.0) }
        }
    }
    fn owned(value: Ref, release: unsafe extern "C" fn(Ref)) -> Result<Owned, Code> {
        if value.is_null() {
            Err(Code::Unavailable)
        } else {
            Ok(Owned(value, release))
        }
    }
    // SAFETY: input stays alive until the document and provider are released;
    // each retained CoreGraphics object is released once via Owned. Pixel
    // dimensions and allocation are checked before passing a stable buffer.
    unsafe {
        let provider = owned(
            CGDataProviderCreateWithData(
                std::ptr::null_mut(),
                bytes.as_ptr().cast(),
                bytes.len(),
                None,
            ),
            CGDataProviderRelease,
        )?;
        let document = owned(
            CGPDFDocumentCreateWithProvider(provider.0),
            CGPDFDocumentRelease,
        )?;
        let count = CGPDFDocumentGetNumberOfPages(document.0);
        if !(1..=256).contains(&count) {
            return Err(Code::LimitExceeded);
        }
        let index = index.min(count - 1);
        let pdf_page = CGPDFDocumentGetPage(document.0, index + 1);
        if pdf_page.is_null() {
            return Err(Code::Unavailable);
        }
        let rect = CGPDFPageGetBoxRect(pdf_page, 1);
        let mut w = rect.size.width;
        let mut h = rect.size.height;
        if !w.is_finite() || !h.is_finite() || w <= 0.0 || h <= 0.0 {
            return Err(Code::IntegrityFailed);
        }
        if CGPDFPageGetRotationAngle(pdf_page).rem_euclid(180) == 90 {
            std::mem::swap(&mut w, &mut h);
        }
        let scale = (4_000_000.0 / (w * h)).sqrt().min(2.0);
        let width = (w * scale).floor().max(1.0) as usize;
        let height = (h * scale).floor().max(1.0) as usize;
        let pixels = width
            .checked_mul(height)
            .filter(|n| *n <= 4_000_000)
            .ok_or(Code::LimitExceeded)?;
        let mut buffer = vec![255_u8; pixels * 4];
        let colors = owned(CGColorSpaceCreateDeviceRGB(), CGColorSpaceRelease)?;
        let bitmap = owned(
            CGBitmapContextCreate(
                buffer.as_mut_ptr().cast(),
                width,
                height,
                8,
                width * 4,
                colors.0,
                0x4001,
            ),
            CGContextRelease,
        )?;
        let target = Rect {
            origin: Point { x: 0.0, y: 0.0 },
            size: Size {
                width: width as f64,
                height: height as f64,
            },
        };
        CGContextSetRGBFillColor(bitmap.0, 1.0, 1.0, 1.0, 1.0);
        CGContextFillRect(bitmap.0, target);
        // CGPDFPageGetDrawingTransform only scales down. Scale the bitmap
        // context explicitly for Retina pixels and let Quartz keep its native
        // PDF coordinate orientation (the bitmap rows are already top first).
        CGContextScaleCTM(bitmap.0, width as f64 / w, height as f64 / h);
        let logical = Rect {
            origin: Point { x: 0.0, y: 0.0 },
            size: Size {
                width: w,
                height: h,
            },
        };
        CGContextConcatCTM(
            bitmap.0,
            CGPDFPageGetDrawingTransform(pdf_page, 1, logical, 0, true),
        );
        CGContextDrawPDFPage(bitmap.0, pdf_page);
        drop(bitmap);
        let image = image::RgbaImage::from_raw(width as u32, height as u32, buffer)
            .ok_or(Code::Unavailable)?;
        let mut out = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut out, image::ImageFormat::Png)
            .map_err(|_| Code::Unavailable)?;
        Ok((count, index, out.into_inner()))
    }
}
