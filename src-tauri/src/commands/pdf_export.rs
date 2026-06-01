#[tauri::command]
pub fn export_current_webview_pdf(
    window: tauri::WebviewWindow,
    output_path: String,
) -> Result<(), String> {
    native::export_current_webview_pdf(window, output_path)
}

#[tauri::command]
pub fn can_export_current_webview_pdf() -> bool {
    native::can_export_current_webview_pdf()
}

#[cfg(target_os = "macos")]
mod native {
    use std::path::Path;
    use std::sync::mpsc;
    use std::time::Duration;

    use objc2::runtime::ProtocolObject;
    use objc2::ClassType;
    use objc2_app_kit::{NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob};
    use objc2_foundation::{NSString, NSURL};
    use objc2_web_kit::WKWebView;

    const PDF_EXPORT_TIMEOUT: Duration = Duration::from_secs(15);

    pub fn can_export_current_webview_pdf() -> bool {
        true
    }

    pub fn export_current_webview_pdf(
        window: tauri::WebviewWindow,
        output_path: String,
    ) -> Result<(), String> {
        validate_output_path(&output_path)?;
        let (sender, receiver) = mpsc::channel();

        window
            .with_webview(move |webview| {
                let result = save_webview_pdf(webview, &output_path);
                let _ = sender.send(result);
            })
            .map_err(|error| format!("Failed to access the current webview: {error}"))?;

        receiver
            .recv_timeout(PDF_EXPORT_TIMEOUT)
            .map_err(|_| "Timed out while exporting the current note as PDF".to_string())?
    }

    fn validate_output_path(output_path: &str) -> Result<(), String> {
        if output_path.trim().is_empty() {
            return Err("Missing PDF export path".to_string());
        }

        let path = Path::new(output_path);
        if path.file_name().is_none() {
            return Err("PDF export path must include a file name".to_string());
        }

        Ok(())
    }

    fn save_webview_pdf(
        webview: tauri::webview::PlatformWebview,
        output_path: &str,
    ) -> Result<(), String> {
        let output = NSString::from_str(output_path);
        let output_url = NSURL::fileURLWithPath(&output);
        let print_info = NSPrintInfo::sharedPrintInfo();
        let print_settings = unsafe { print_info.dictionary() };
        let previous_job_disposition = print_info.jobDisposition();

        print_info.setJobDisposition(unsafe { NSPrintSaveJob });
        unsafe {
            print_settings.setObject_forKey(
                output_url.as_super().as_super(),
                ProtocolObject::from_ref(NSPrintJobSavingURL),
            );
        }

        let webview: &WKWebView = unsafe { &*webview.inner().cast() };
        let window = webview
            .window()
            .ok_or_else(|| "Failed to access the webview window for PDF export".to_string())?;
        let operation = unsafe { webview.printOperationWithPrintInfo(&print_info) };
        operation.setShowsPrintPanel(false);
        operation.setShowsProgressPanel(false);
        operation.setCanSpawnSeparateThread(true);

        unsafe {
            operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                &window,
                None,
                None,
                std::ptr::null_mut(),
            );
        }
        print_info.setJobDisposition(&previous_job_disposition);
        unsafe {
            print_settings.removeObjectForKey(NSPrintJobSavingURL);
        }

        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::validate_output_path;

        #[test]
        fn output_path_requires_a_non_blank_value() {
            assert!(validate_output_path("").is_err());
            assert!(validate_output_path("   ").is_err());
        }

        #[test]
        fn output_path_requires_a_file_name() {
            assert!(validate_output_path("/").is_err());
        }

        #[test]
        fn output_path_accepts_a_pdf_file_path() {
            assert!(validate_output_path("/tmp/tolaria-note.pdf").is_ok());
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod native {
    pub fn can_export_current_webview_pdf() -> bool {
        false
    }

    pub fn export_current_webview_pdf(
        _window: tauri::WebviewWindow,
        _output_path: String,
    ) -> Result<(), String> {
        Err("Direct PDF export is currently only supported on macOS".to_string())
    }
}
