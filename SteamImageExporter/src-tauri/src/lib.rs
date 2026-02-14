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

#[derive(Deserialize, Copy, Clone)]
#[serde(rename_all = "snake_case")]
enum TemplatePreset {
  Balanced,
  Impact,
  Compact,
  Cinematic,
  Corner,
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

#[derive(Copy, Clone)]
enum LogoTemplatePattern {
  CenterLarge,
  BottomCenterWide,
  TopCenterWide,
  MidCenterCompact,
  ImpactCenterHuge,
  CornerBottomRight,
}

#[derive(Copy, Clone)]
enum AnchorX {
  Center,
  Right,
}

#[derive(Copy, Clone)]
enum AnchorY {
  Center,
  Bottom,
}

#[derive(Copy, Clone)]
enum LogoUsage {
  None,
  Overlay(LogoTemplatePattern),
  LogoOnly,
}

#[derive(Copy, Clone)]
struct LogoTemplateSpec {
  max_w: u32,
  max_h: u32,
  anchor_x: AnchorX,
  anchor_y: AnchorY,
  margin_x: u32,
  margin_y: u32,
  offset_x: i32,
  offset_y: i32,
}

#[tauri::command]
async fn export_images(
  window: tauri::Window,
  input_path: String,
  logo_path: Option<String>,
  template_preset: Option<TemplatePreset>,
  output_dir: String,
  targets: Vec<Target>,
  focus: Option<Focus>,
) -> Result<String, String> {
  let window = window.clone();
  tauri::async_runtime::spawn_blocking(move || {
    export_images_inner(
      &window,
      &input_path,
      logo_path.as_deref(),
      template_preset.unwrap_or(TemplatePreset::Balanced),
      &output_dir,
      &targets,
      focus,
    )
  })
  .await
  .map_err(|err| err.to_string())?
  .map_err(|err| err.to_string())
}

#[tauri::command]
async fn create_transparent_logo(
  logo_path: String,
  output_dir: String,
) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    create_transparent_logo_inner(&logo_path, &output_dir)
  })
  .await
  .map_err(|err| err.to_string())?
  .map_err(|err| err.to_string())
}

fn export_images_inner(
  window: &tauri::Window,
  input_path: &str,
  logo_path: Option<&str>,
  template_preset: TemplatePreset,
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

  let requires_logo = targets
    .iter()
    .any(|target| !matches!(logo_usage_for_target(&target.name, template_preset), LogoUsage::None));
  let logo = if requires_logo {
    let logo_path = logo_path
      .filter(|value| !value.trim().is_empty())
      .ok_or_else(|| anyhow::anyhow!("logo image is required for selected targets"))?;
    Some(
      image::open(logo_path)
        .with_context(|| format!("open failed: {}", logo_path))?,
    )
  } else {
    None
  };

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
    let usage = logo_usage_for_target(&target.name, template_preset);
    let base_rendered = render_target(&source, target, focus.as_ref());
    let logo_rendered = match usage {
      LogoUsage::Overlay(pattern) => {
        let logo_image = logo
          .as_ref()
          .ok_or_else(|| anyhow::anyhow!("logo image is required for target: {}", target.name))?;
        Some(apply_logo_template(
          base_rendered.clone(),
          logo_image,
          &target.name,
          pattern,
        ))
      }
      LogoUsage::LogoOnly => {
        let logo_image = logo
          .as_ref()
          .ok_or_else(|| anyhow::anyhow!("logo image is required for target: {}", target.name))?;
        Some(render_logo_only_target(logo_image, target))
      }
      LogoUsage::None => None,
    };
    let base_filename = format!("{}_{}x{}.png", target.name, target.w, target.h);
    let base_output_path = target_dir.join(base_filename);
    let _ = window.emit(
      "export://progress",
      ProgressPayload {
        index: index + 1,
        total,
        name: target.name.clone(),
        phase: "save",
      },
    );
    base_rendered
      .save_with_format(&base_output_path, ImageFormat::Png)
      .with_context(|| format!("save failed: {}", base_output_path.display()))?;
    if let Some(logo_image) = logo_rendered {
      let logo_filename = format!("{}_{}x{}_logo.png", target.name, target.w, target.h);
      let logo_output_path = target_dir.join(logo_filename);
      logo_image
        .save_with_format(&logo_output_path, ImageFormat::Png)
        .with_context(|| format!("save failed: {}", logo_output_path.display()))?;
    }
  }

  let _ = window.emit("export://complete", ());
  Ok(target_dir.to_string_lossy().to_string())
}

fn create_transparent_logo_inner(logo_path: &str, output_dir: &str) -> Result<String> {
  let output_root = Path::new(output_dir);
  if !output_root.is_dir() {
    bail!("output dir not found: {}", output_dir);
  }

  let source = image::open(logo_path)
    .with_context(|| format!("open failed: {}", logo_path))?;
  let mut rgba = source.to_rgba8();
  auto_remove_background(&mut rgba);

  let base_name = Path::new(logo_path)
    .file_stem()
    .and_then(|name| name.to_str())
    .unwrap_or("logo");
  let safe_name = base_name
    .chars()
    .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
    .collect::<String>();
  let stamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs();
  let output_path = output_root.join(format!("{}_transparent_{}.png", safe_name, stamp));

  DynamicImage::ImageRgba8(rgba)
    .save_with_format(&output_path, ImageFormat::Png)
    .with_context(|| format!("save failed: {}", output_path.display()))?;

  Ok(output_path.to_string_lossy().to_string())
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

fn auto_remove_background(image: &mut RgbaImage) {
  let (w, h) = image.dimensions();
  if w == 0 || h == 0 {
    return;
  }
  let bg = estimate_background_color(image);
  let transparent_threshold_sq: i32 = 28 * 28;
  let solid_threshold_sq: i32 = 60 * 60;

  for pixel in image.pixels_mut() {
    let dr = i32::from(pixel[0]) - i32::from(bg[0]);
    let dg = i32::from(pixel[1]) - i32::from(bg[1]);
    let db = i32::from(pixel[2]) - i32::from(bg[2]);
    let dist_sq = dr * dr + dg * dg + db * db;
    let base_alpha = u16::from(pixel[3]);

    let next_alpha_u16 = if dist_sq <= transparent_threshold_sq {
      0
    } else if dist_sq >= solid_threshold_sq {
      base_alpha
    } else {
      let span = solid_threshold_sq - transparent_threshold_sq;
      let keep = dist_sq - transparent_threshold_sq;
      let scaled = (i64::from(base_alpha) * i64::from(keep)) / i64::from(span);
      scaled as u16
    };
    pixel[3] = next_alpha_u16.min(255) as u8;
  }
}

fn estimate_background_color(image: &RgbaImage) -> [u8; 3] {
  let (w, h) = image.dimensions();
  let stride_x = ((w / 200).max(1)) as usize;
  let stride_y = ((h / 200).max(1)) as usize;
  let mut sum_r: u64 = 0;
  let mut sum_g: u64 = 0;
  let mut sum_b: u64 = 0;
  let mut count: u64 = 0;

  for x in (0..w).step_by(stride_x) {
    let top = image.get_pixel(x, 0);
    let bottom = image.get_pixel(x, h - 1);
    sum_r += u64::from(top[0]) + u64::from(bottom[0]);
    sum_g += u64::from(top[1]) + u64::from(bottom[1]);
    sum_b += u64::from(top[2]) + u64::from(bottom[2]);
    count += 2;
  }

  for y in (0..h).step_by(stride_y) {
    let left = image.get_pixel(0, y);
    let right = image.get_pixel(w - 1, y);
    sum_r += u64::from(left[0]) + u64::from(right[0]);
    sum_g += u64::from(left[1]) + u64::from(right[1]);
    sum_b += u64::from(left[2]) + u64::from(right[2]);
    count += 2;
  }

  if count == 0 {
    return [0, 0, 0];
  }

  [
    (sum_r / count) as u8,
    (sum_g / count) as u8,
    (sum_b / count) as u8,
  ]
}

fn logo_usage_for_target(target_name: &str, template_preset: TemplatePreset) -> LogoUsage {
  match target_name {
    "header_capsule" | "headercapsule" => match template_preset {
      TemplatePreset::Balanced => LogoUsage::Overlay(LogoTemplatePattern::CenterLarge),
      TemplatePreset::Impact => LogoUsage::Overlay(LogoTemplatePattern::ImpactCenterHuge),
      TemplatePreset::Compact => LogoUsage::Overlay(LogoTemplatePattern::MidCenterCompact),
      TemplatePreset::Cinematic => LogoUsage::Overlay(LogoTemplatePattern::TopCenterWide),
      TemplatePreset::Corner => LogoUsage::Overlay(LogoTemplatePattern::CornerBottomRight),
    },
    "small_capsule" => match template_preset {
      TemplatePreset::Balanced => LogoUsage::Overlay(LogoTemplatePattern::CenterLarge),
      TemplatePreset::Impact => LogoUsage::Overlay(LogoTemplatePattern::ImpactCenterHuge),
      TemplatePreset::Compact => LogoUsage::Overlay(LogoTemplatePattern::MidCenterCompact),
      TemplatePreset::Cinematic => LogoUsage::Overlay(LogoTemplatePattern::TopCenterWide),
      TemplatePreset::Corner => LogoUsage::Overlay(LogoTemplatePattern::CornerBottomRight),
    },
    "main_capsule" => match template_preset {
      TemplatePreset::Balanced => LogoUsage::Overlay(LogoTemplatePattern::CenterLarge),
      TemplatePreset::Impact => LogoUsage::Overlay(LogoTemplatePattern::ImpactCenterHuge),
      TemplatePreset::Compact => LogoUsage::Overlay(LogoTemplatePattern::MidCenterCompact),
      TemplatePreset::Cinematic => LogoUsage::Overlay(LogoTemplatePattern::TopCenterWide),
      TemplatePreset::Corner => LogoUsage::Overlay(LogoTemplatePattern::CornerBottomRight),
    },
    "vertical_capsule" => match template_preset {
      TemplatePreset::Balanced => LogoUsage::Overlay(LogoTemplatePattern::BottomCenterWide),
      TemplatePreset::Impact => LogoUsage::Overlay(LogoTemplatePattern::ImpactCenterHuge),
      TemplatePreset::Compact => LogoUsage::Overlay(LogoTemplatePattern::MidCenterCompact),
      TemplatePreset::Cinematic => LogoUsage::Overlay(LogoTemplatePattern::TopCenterWide),
      TemplatePreset::Corner => LogoUsage::Overlay(LogoTemplatePattern::CornerBottomRight),
    },
    "library_capsule" => match template_preset {
      TemplatePreset::Balanced => LogoUsage::Overlay(LogoTemplatePattern::CenterLarge),
      TemplatePreset::Impact => LogoUsage::Overlay(LogoTemplatePattern::ImpactCenterHuge),
      TemplatePreset::Compact => LogoUsage::Overlay(LogoTemplatePattern::MidCenterCompact),
      TemplatePreset::Cinematic => LogoUsage::Overlay(LogoTemplatePattern::TopCenterWide),
      TemplatePreset::Corner => LogoUsage::Overlay(LogoTemplatePattern::CornerBottomRight),
    },
    "library_logo" => LogoUsage::LogoOnly,
    _ => LogoUsage::None,
  }
}

fn logo_template_spec(
  pattern: LogoTemplatePattern,
  target_name: &str,
  target_w: u32,
  target_h: u32,
) -> LogoTemplateSpec {
  let (max_w_ratio, max_h_ratio, anchor_x, anchor_y, margin_x_ratio, margin_y_ratio, offset_x_ratio, offset_y_ratio) = match (target_name, pattern) {
    ("header_capsule", LogoTemplatePattern::CenterLarge)
    | ("headercapsule", LogoTemplatePattern::CenterLarge) => (0.42, 0.62, AnchorX::Center, AnchorY::Center, 0.04, 0.04, 0.0, 0.20),
    ("header_capsule", LogoTemplatePattern::BottomCenterWide)
    | ("headercapsule", LogoTemplatePattern::BottomCenterWide) => (0.48, 0.68, AnchorX::Center, AnchorY::Center, 0.04, 0.04, 0.0, 0.26),
    ("small_capsule", LogoTemplatePattern::CenterLarge) => (0.50, 0.72, AnchorX::Center, AnchorY::Center, 0.04, 0.08, 0.0, 0.18),
    ("small_capsule", LogoTemplatePattern::BottomCenterWide) => (0.58, 0.80, AnchorX::Center, AnchorY::Center, 0.04, 0.08, 0.0, 0.24),
    ("main_capsule", LogoTemplatePattern::CenterLarge) => (0.48, 0.56, AnchorX::Center, AnchorY::Center, 0.04, 0.04, 0.0, 0.18),
    ("main_capsule", LogoTemplatePattern::BottomCenterWide) => (0.56, 0.62, AnchorX::Center, AnchorY::Center, 0.04, 0.04, 0.0, 0.24),
    ("vertical_capsule", LogoTemplatePattern::CenterLarge) => (0.70, 0.34, AnchorX::Center, AnchorY::Center, 0.05, 0.04, 0.0, -0.02),
    ("vertical_capsule", LogoTemplatePattern::BottomCenterWide) => (0.74, 0.38, AnchorX::Center, AnchorY::Center, 0.05, 0.04, 0.0, 0.08),
    ("library_capsule", LogoTemplatePattern::CenterLarge) => (0.78, 0.32, AnchorX::Center, AnchorY::Center, 0.05, 0.04, 0.0, -0.03),
    ("library_capsule", LogoTemplatePattern::BottomCenterWide) => (0.84, 0.38, AnchorX::Center, AnchorY::Center, 0.05, 0.04, 0.0, 0.05),
    ("header_capsule", LogoTemplatePattern::TopCenterWide)
    | ("headercapsule", LogoTemplatePattern::TopCenterWide) => (0.46, 0.62, AnchorX::Center, AnchorY::Center, 0.04, 0.04, 0.0, -0.20),
    ("small_capsule", LogoTemplatePattern::TopCenterWide) => (0.56, 0.76, AnchorX::Center, AnchorY::Center, 0.04, 0.12, 0.0, -0.12),
    ("main_capsule", LogoTemplatePattern::TopCenterWide) => (0.54, 0.58, AnchorX::Center, AnchorY::Center, 0.04, 0.04, 0.0, -0.16),
    ("vertical_capsule", LogoTemplatePattern::TopCenterWide) => (0.72, 0.36, AnchorX::Center, AnchorY::Center, 0.05, 0.04, 0.0, -0.22),
    ("library_capsule", LogoTemplatePattern::TopCenterWide) => (0.82, 0.36, AnchorX::Center, AnchorY::Center, 0.05, 0.04, 0.0, -0.20),
    ("header_capsule", LogoTemplatePattern::MidCenterCompact)
    | ("headercapsule", LogoTemplatePattern::MidCenterCompact) => (0.34, 0.52, AnchorX::Center, AnchorY::Center, 0.04, 0.04, 0.0, 0.14),
    ("small_capsule", LogoTemplatePattern::MidCenterCompact) => (0.42, 0.62, AnchorX::Center, AnchorY::Center, 0.04, 0.08, 0.0, 0.12),
    ("main_capsule", LogoTemplatePattern::MidCenterCompact) => (0.40, 0.46, AnchorX::Center, AnchorY::Center, 0.04, 0.04, 0.0, 0.12),
    ("vertical_capsule", LogoTemplatePattern::MidCenterCompact) => (0.62, 0.30, AnchorX::Center, AnchorY::Center, 0.05, 0.04, 0.0, -0.04),
    ("library_capsule", LogoTemplatePattern::MidCenterCompact) => (0.70, 0.28, AnchorX::Center, AnchorY::Center, 0.05, 0.04, 0.0, -0.06),
    ("header_capsule", LogoTemplatePattern::ImpactCenterHuge)
    | ("headercapsule", LogoTemplatePattern::ImpactCenterHuge) => (0.84, 0.96, AnchorX::Center, AnchorY::Center, 0.05, 0.05, 0.0, 0.0),
    ("small_capsule", LogoTemplatePattern::ImpactCenterHuge) => (0.68, 0.88, AnchorX::Center, AnchorY::Center, 0.05, 0.10, 0.0, 0.0),
    ("main_capsule", LogoTemplatePattern::ImpactCenterHuge) => (0.66, 0.70, AnchorX::Center, AnchorY::Center, 0.05, 0.05, 0.0, 0.0),
    ("vertical_capsule", LogoTemplatePattern::ImpactCenterHuge) => (0.82, 0.42, AnchorX::Center, AnchorY::Center, 0.06, 0.05, 0.0, 0.0),
    ("library_capsule", LogoTemplatePattern::ImpactCenterHuge) => (0.90, 0.44, AnchorX::Center, AnchorY::Center, 0.06, 0.05, 0.0, 0.0),
    ("header_capsule", LogoTemplatePattern::CornerBottomRight)
    | ("headercapsule", LogoTemplatePattern::CornerBottomRight) => (0.24, 0.40, AnchorX::Right, AnchorY::Bottom, 0.03, 0.04, 0.00, 0.00),
    ("small_capsule", LogoTemplatePattern::CornerBottomRight) => (0.28, 0.46, AnchorX::Right, AnchorY::Bottom, 0.03, 0.09, 0.00, 0.00),
    ("main_capsule", LogoTemplatePattern::CornerBottomRight) => (0.28, 0.34, AnchorX::Right, AnchorY::Bottom, 0.03, 0.04, 0.00, 0.00),
    ("vertical_capsule", LogoTemplatePattern::CornerBottomRight) => (0.46, 0.28, AnchorX::Right, AnchorY::Bottom, 0.04, 0.05, 0.00, 0.00),
    ("library_capsule", LogoTemplatePattern::CornerBottomRight) => (0.50, 0.24, AnchorX::Right, AnchorY::Bottom, 0.04, 0.05, 0.00, 0.00),
    (_, LogoTemplatePattern::CenterLarge) => (0.70, 0.44, AnchorX::Center, AnchorY::Center, 0.04, 0.04, 0.0, 0.0),
    (_, LogoTemplatePattern::BottomCenterWide) => (0.78, 0.50, AnchorX::Center, AnchorY::Center, 0.04, 0.04, 0.0, 0.08),
    (_, LogoTemplatePattern::TopCenterWide) => (0.72, 0.46, AnchorX::Center, AnchorY::Center, 0.04, 0.04, 0.0, -0.12),
    (_, LogoTemplatePattern::MidCenterCompact) => (0.62, 0.38, AnchorX::Center, AnchorY::Center, 0.04, 0.04, 0.0, 0.08),
    (_, LogoTemplatePattern::ImpactCenterHuge) => (0.82, 0.56, AnchorX::Center, AnchorY::Center, 0.05, 0.05, 0.0, 0.0),
    (_, LogoTemplatePattern::CornerBottomRight) => (0.34, 0.24, AnchorX::Right, AnchorY::Bottom, 0.04, 0.05, 0.00, 0.00),
  };
  let max_w = ((target_w as f32) * max_w_ratio).round().max(1.0) as u32;
  let max_h = ((target_h as f32) * max_h_ratio).round().max(1.0) as u32;
  let margin_x = ((target_w as f32) * margin_x_ratio).round().max(1.0) as u32;
  let margin_y = ((target_h as f32) * margin_y_ratio).round().max(1.0) as u32;
  let offset_x = ((target_w as f32) * offset_x_ratio).round() as i32;
  let offset_y = ((target_h as f32) * offset_y_ratio).round() as i32;
  LogoTemplateSpec { max_w, max_h, anchor_x, anchor_y, margin_x, margin_y, offset_x, offset_y }
}

fn apply_logo_template(
  rendered: DynamicImage,
  logo_source: &DynamicImage,
  target_name: &str,
  pattern: LogoTemplatePattern,
) -> DynamicImage {
  let (target_w, target_h) = rendered.dimensions();
  let spec = logo_template_spec(pattern, target_name, target_w, target_h);
  let spec = adjust_spec_for_logo_orientation(
    spec,
    logo_source.width(),
    logo_source.height(),
    target_w,
    target_h,
  );
  let margin_x = spec.margin_x.min(target_w.saturating_sub(1) / 2);
  let margin_y = spec.margin_y.min(target_h.saturating_sub(1) / 2);
  let allowed_w = target_w.saturating_sub(margin_x.saturating_mul(2)).max(1);
  let allowed_h = target_h.saturating_sub(margin_y.saturating_mul(2)).max(1);
  let (logo_w, logo_h) = contain_dimensions(
    logo_source.width(),
    logo_source.height(),
    spec.max_w.min(allowed_w),
    spec.max_h.min(allowed_h),
  );
  let logo = logo_source
    .resize_exact(logo_w, logo_h, FilterType::Lanczos3)
    .to_rgba8();

  let min_x = margin_x;
  let min_y = margin_y;
  let max_x = target_w.saturating_sub(logo_w).saturating_sub(margin_x);
  let max_y = target_h.saturating_sub(logo_h).saturating_sub(margin_y);
  let center_x = min_x + (max_x.saturating_sub(min_x)) / 2;
  let center_y = min_y + (max_y.saturating_sub(min_y)) / 2;
  let right_x = max_x;
  let bottom_y = max_y;

  let offset_x_abs = spec.offset_x.unsigned_abs();
  let offset_y_abs = spec.offset_y.unsigned_abs();
  let anchored_x = match spec.anchor_x {
    AnchorX::Center => {
      if spec.offset_x >= 0 {
        center_x.saturating_add(offset_x_abs)
      } else {
        center_x.saturating_sub(offset_x_abs)
      }
    }
    AnchorX::Right => right_x.saturating_sub(offset_x_abs),
  };
  let anchored_y = match spec.anchor_y {
    AnchorY::Center => {
      if spec.offset_y >= 0 {
        center_y.saturating_add(offset_y_abs)
      } else {
        center_y.saturating_sub(offset_y_abs)
      }
    }
    AnchorY::Bottom => bottom_y.saturating_sub(offset_y_abs),
  };
  let final_x = anchored_x.max(min_x).min(max_x);
  let final_y = anchored_y.max(min_y).min(max_y);

  let mut canvas = rendered.to_rgba8();
  imageops::overlay(&mut canvas, &logo, final_x.into(), final_y.into());
  DynamicImage::ImageRgba8(canvas)
}

fn adjust_spec_for_logo_orientation(
  mut spec: LogoTemplateSpec,
  logo_w: u32,
  logo_h: u32,
  target_w: u32,
  target_h: u32,
) -> LogoTemplateSpec {
  if logo_w == 0 || logo_h == 0 {
    return spec;
  }
  let ratio = logo_w as f32 / logo_h as f32;
  if ratio < 0.9 {
    let t = ((0.9 - ratio) / 0.9).clamp(0.0, 1.0);
    spec.max_h = ((spec.max_h as f32) * (1.0 - 0.24 * t)).round().max(1.0) as u32;
    let extra_margin = ((target_h as f32) * (0.04 * t)).round().max(0.0) as u32;
    spec.margin_y = spec.margin_y.saturating_add(extra_margin);
    spec.offset_y = ((spec.offset_y as f32) * (1.0 - 0.80 * t)).round() as i32;
  } else if ratio > 1.1 {
    let t = ((ratio - 1.1) / 2.4).clamp(0.0, 1.0);
    spec.max_w = ((spec.max_w as f32) * (1.0 - 0.15 * t)).round().max(1.0) as u32;
    let extra_margin = ((target_w as f32) * (0.02 * t)).round().max(0.0) as u32;
    spec.margin_x = spec.margin_x.saturating_add(extra_margin);
    spec.offset_x = ((spec.offset_x as f32) * (1.0 - 0.35 * t)).round() as i32;
  }
  spec
}

fn render_logo_only_target(logo_source: &DynamicImage, target: &Target) -> DynamicImage {
  let (logo_w, logo_h) = contain_dimensions(
    logo_source.width(),
    logo_source.height(),
    target.w,
    target.h,
  );
  let offset_x = (target.w - logo_w) / 2;
  let offset_y = (target.h - logo_h) / 2;
  let logo = logo_source
    .resize_exact(logo_w, logo_h, FilterType::Lanczos3)
    .to_rgba8();

  let mut canvas = RgbaImage::from_pixel(target.w, target.h, Rgba([0, 0, 0, 0]));
  imageops::overlay(&mut canvas, &logo, offset_x.into(), offset_y.into());
  DynamicImage::ImageRgba8(canvas)
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
    .invoke_handler(tauri::generate_handler![export_images, create_transparent_logo])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
