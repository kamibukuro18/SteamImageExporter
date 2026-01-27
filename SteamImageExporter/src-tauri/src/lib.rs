use anyhow::{bail, Context, Result};
use image::{imageops::FilterType, DynamicImage, GenericImageView, ImageFormat};
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
struct Target {
  name: String,
  w: u32,
  h: u32,
}

#[tauri::command]
fn export_images(input_path: String, output_dir: String, targets: Vec<Target>) -> Result<(), String> {
  export_images_inner(&input_path, &output_dir, &targets).map_err(|err| err.to_string())
}

fn export_images_inner(input_path: &str, output_dir: &str, targets: &[Target]) -> Result<()> {
  let source = image::open(input_path)
    .with_context(|| format!("open failed: {}", input_path))?;

  let out_dir = Path::new(output_dir);
  if !out_dir.is_dir() {
    bail!("output dir not found: {}", output_dir);
  }

  for target in targets {
    let rendered = render_target(&source, target);
    let filename = format!("{}_{}x{}.png", target.name, target.w, target.h);
    let output_path = out_dir.join(filename);
    rendered
      .save_with_format(&output_path, ImageFormat::Png)
      .with_context(|| format!("save failed: {}", output_path.display()))?;
  }

  Ok(())
}

fn render_target(source: &DynamicImage, target: &Target) -> DynamicImage {
  let (iw, ih) = source.dimensions();
  let input_ratio = iw as f64 / ih as f64;
  let target_ratio = target.w as f64 / target.h as f64;
  let ratio_diff = (input_ratio - target_ratio).abs();

  let (crop_x, crop_y, crop_w, crop_h) = if ratio_diff < 0.000001 {
    (0, 0, iw, ih)
  } else if input_ratio > target_ratio {
    let crop_w = ((ih as f64) * target_ratio).floor().max(1.0) as u32;
    let crop_x = (iw - crop_w) / 2;
    (crop_x, 0, crop_w, ih)
  } else {
    let crop_h = ((iw as f64) / target_ratio).floor().max(1.0) as u32;
    let crop_y = (ih - crop_h) / 2;
    (0, crop_y, iw, crop_h)
  };

  let cropped = source.crop_imm(crop_x, crop_y, crop_w, crop_h);
  cropped.resize_exact(target.w, target.h, FilterType::Lanczos3)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![export_images])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
