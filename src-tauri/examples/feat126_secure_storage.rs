fn main() {
    let action = std::env::args().nth(1).unwrap_or_default();
    match yijie_desktop_lib::feat126_secure_storage_test_control(&action) {
        Ok(evidence) => match serde_json::to_string(&evidence) {
            Ok(encoded) => println!("{encoded}"),
            Err(_) => {
                eprintln!("secure_storage_evidence_failed");
                std::process::exit(1);
            }
        },
        Err(code) => {
            eprintln!("{code}");
            std::process::exit(1);
        }
    }
}
