use anyhow::{bail, Context, Result};
use image::{
  imageops::{self, FilterType},
  DynamicImage, GenericImageView, ImageFormat, Rgba, RgbaImage,
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;

#[derive(Deserialize, Copy, Clone)]
#[serde(rename_all = "snake_case")]
enum Mode {
  Fill,
  Fit,
  FitExtend,
}

#[derive(Deserialize)]
struct Target {
  name: String,
  w: u32,
  h: u32,
  mode: Mode,
}

#[derive(Deserialize, Copy, Clone)]
struct Focus {
  x: u32,
  y: u32,
}

#[derive(Clone, Serialize)]
struct ProgressPayload {
  index: usize,
  total: usize,
  name: String,
  phase: &'static str,
}

#[tauri::command]
async fn export_images(
  window: tauri::Window,
  input_path: String,
  output_dir: String,
  targets: Vec<Target>,
  focus: Option<Focus>,
) -> Result<String, String> {
  let window = window.clone();
  tauri::async_runtime::spawn_blocking(move || {
    export_images_inner(&window, &input_path, &output_dir, &targets, focus)
  })
  .await
  .map_err(|err| err.to_string())?
  .map_err(|err| err.to_string())
}

fn export_images_inner(
  window: &tauri::Window,
  input_path: &str,
  output_dir: &str,
  targets: &[Target],
  focus: Option<Focus>,
) -> Result<String> {
  let source = image::open(input_path)
    .with_context(|| format!("open failed: {}", input_path))?;

  let out_dir = Path::new(output_dir);
  if !out_dir.is_dir() {
    bail!("output dir not found: {}", output_dir);
  }

  let base_name = Path::new(input_path)
    .file_stem()
    .and_then(|name| name.to_str())
    .unwrap_or("steam_images");
  let safe_name = base_name
    .chars()
    .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
    .collect::<String>();
  let stamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs();
  let dir_name = format!("{}_steam_{}", safe_name, stamp);
  let target_dir = out_dir.join(dir_name);
  std::fs::create_dir_all(&target_dir)
    .with_context(|| format!("create dir failed: {}", target_dir.display()))?;

  let total = targets.len();
  for (index, target) in targets.iter().enumerate() {
    let _ = window.emit(
      "export://progress",
      ProgressPayload {
        index: index + 1,
        total,
        name: target.name.clone(),
        phase: "render",
      },
    );
    let rendered = render_target(&source, target, focus.as_ref());
    let filename = format!("{}_{}x{}.png", target.name, target.w, target.h);
    let output_path = target_dir.join(filename);
    let _ = window.emit(
      "export://progress",
      ProgressPayload {
        index: index + 1,
        total,
        name: target.name.clone(),
        phase: "save",
      },
    );
    rendered
      .save_with_format(&output_path, ImageFormat::Png)
      .with_context(|| format!("save failed: {}", output_path.display()))?;
  }

  let _ = window.emit("export://complete", ());
  Ok(target_dir.to_string_lossy().to_string())
}

fn render_target(source: &DynamicImage, target: &Target, focus: Option<&Focus>) -> DynamicImage {
  match target.mode {
    Mode::Fill => render_fill(source, target, focus),
    Mode::Fit => render_fit(source, target),
    Mode::FitExtend => render_fit_extend(source, target),
  }
}

fn render_fill(source: &DynamicImage, target: &Target, focus: Option<&Focus>) -> DynamicImage {
  let (iw, ih) = source.dimensions();
  let input_ratio = iw as f64 / ih as f64;
  let target_ratio = target.w as f64 / target.h as f64;
  let ratio_diff = (input_ratio - target_ratio).abs();

  if ratio_diff < 0.000001 {
    return source.resize_exact(target.w, target.h, FilterType::Lanczos3);
  }

  let (crop_x, crop_y, crop_w, crop_h) = if input_ratio > target_ratio {
    let crop_w = ((ih as f64) * target_ratio).floor().max(1.0) as u32;
    let crop_x = focus
      .map(|point| clamp_focus_x(point.x, crop_w, iw))
      .unwrap_or_else(|| (iw - crop_w) / 2);
    (crop_x, 0, crop_w, ih)
  } else {
    let crop_h = ((iw as f64) / target_ratio).floor().max(1.0) as u32;
    let crop_y = focus
      .map(|point| clamp_focus_y(point.y, crop_h, ih))
      .unwrap_or_else(|| (ih - crop_h) / 2);
    (0, crop_y, iw, crop_h)
  };

  let cropped = source.crop_imm(crop_x, crop_y, crop_w, crop_h);
  cropped.resize_exact(target.w, target.h, FilterType::Lanczos3)
}

fn render_fit(source: &DynamicImage, target: &Target) -> DynamicImage {
  let (iw, ih) = source.dimensions();
  let (fg_w, fg_h) = contain_dimensions(iw, ih, target.w, target.h);
  let offset_x = (target.w - fg_w) / 2;
  let offset_y = (target.h - fg_h) / 2;
  let foreground = source
    .resize_exact(fg_w, fg_h, FilterType::Lanczos3)
    .to_rgba8();
  let mut canvas = RgbaImage::from_pixel(target.w, target.h, Rgba([0, 0, 0, 255]));
  imageops::overlay(&mut canvas, &foreground, offset_x.into(), offset_y.into());
  DynamicImage::ImageRgba8(canvas)
}

fn render_fit_extend(source: &DynamicImage, target: &Target) -> DynamicImage {
  let (iw, ih) = source.dimensions();
  let (fg_w, fg_h) = contain_dimensions(iw, ih, target.w, target.h);
  let offset_x = (target.w - fg_w) / 2;
  let offset_y = (target.h - fg_h) / 2;
  let foreground = source
    .resize_exact(fg_w, fg_h, FilterType::Lanczos3)
    .to_rgba8();
  let background = source
    .resize_exact(target.w, target.h, FilterType::Triangle)
    .blur(25.0)
    .to_rgba8();
  let mut canvas = background;
  imageops::overlay(&mut canvas, &foreground, offset_x.into(), offset_y.into());
  DynamicImage::ImageRgba8(canvas)
}

fn contain_dimensions(iw: u32, ih: u32, tw: u32, th: u32) -> (u32, u32) {
  let scale = f64::min(tw as f64 / iw as f64, th as f64 / ih as f64);
  let mut w = ((iw as f64) * scale).round() as u32;
  let mut h = ((ih as f64) * scale).round() as u32;
  if w == 0 {
    w = 1;
  }
  if h == 0 {
    h = 1;
  }
  if w > tw {
    w = tw;
  }
  if h > th {
    h = th;
  }
  (w, h)
}

fn clamp_focus_x(focus_x: u32, crop_w: u32, iw: u32) -> u32 {
  if iw <= crop_w {
    return 0;
  }
  let max_x = (iw - crop_w) as i64;
  let mut crop_x = focus_x as i64 - (crop_w as i64) / 2;
  if crop_x < 0 {
    crop_x = 0;
  }
  if crop_x > max_x {
    crop_x = max_x;
  }
  crop_x as u32
}

fn clamp_focus_y(focus_y: u32, crop_h: u32, ih: u32) -> u32 {
  if ih <= crop_h {
    return 0;
  }
  let max_y = (ih - crop_h) as i64;
  let mut crop_y = focus_y as i64 - (crop_h as i64) / 2;
  if crop_y < 0 {
    crop_y = 0;
  }
  if crop_y > max_y {
    crop_y = max_y;
  }
  crop_y as u32
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
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
