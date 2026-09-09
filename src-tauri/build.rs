fn main() {
    // Tauri requires an ICO for the Windows executable. Keep this minimal
    // one-pixel resource generated in the build output until product artwork exists.
    let icon_path = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("icons")
        .join("icon.ico");
    std::fs::create_dir_all(icon_path.parent().unwrap()).expect("cannot create the icon directory");
    std::fs::write(
        &icon_path,
        [
            0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 32, 0, 48, 0, 0, 0, 22, 0, 0, 0,
            40, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 8, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 73, 98,
            39, 255, 0, 0, 0, 0,
        ],
    )
    .expect("cannot create the generated Windows icon");
    let attributes = tauri_build::Attributes::new().windows_attributes(
        tauri_build::WindowsAttributes::new().window_icon_path(icon_path),
    );
    tauri_build::try_build(attributes).expect("error while building Tauri application");
}
