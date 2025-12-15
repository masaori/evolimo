mod evo;
mod mapping;
mod renderer;

use std::{
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};

use anyhow::{bail, Context, Result};
use clap::Parser;
use evo::EvoFile;
use mapping::{apply_scale, clamp01, eval_source, normalize, VisualMapping};
use renderer::{Instance, Renderer};
use winit::{
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};

#[derive(Debug, Parser)]
#[command(name = "evolimo-visualizer")]
struct Args {
    /// Path to sim_output.evo
    #[arg(long, default_value = "../simulator/sim_output.evo")]
    input: PathBuf,

    /// Path to visual_mapping.json
    #[arg(long, default_value = "../domain-model/_gen/visual_mapping.json")]
    mapping: PathBuf,

    /// Simulation playback FPS
    #[arg(long, default_value_t = 60.0)]
    sim_fps: f64,
}

fn colormap_rgb(name: &str, t01: f32) -> Result<[u8; 3]> {
    let t = clamp01(t01) as f64;
    let c = match name {
        "viridis" => colorous::VIRIDIS.eval_continuous(t),
        "plasma" => colorous::PLASMA.eval_continuous(t),
        // Approximate "heat" and "cool" with available gradients.
        "heat" => colorous::INFERNO.eval_continuous(t),
        "cool" => colorous::TURBO.eval_continuous(t),
        other => bail!("unsupported colormap: {other}"),
    };
    Ok([c.r, c.g, c.b])
}

fn main() -> Result<()> {
    let args = Args::parse();
    if !(args.sim_fps.is_finite() && args.sim_fps > 0.0) {
        bail!("--sim-fps must be a positive finite number");
    }

    let mapping_bytes = fs::read(&args.mapping)
        .with_context(|| format!("failed to read mapping: {:?}", args.mapping))?;
    let mapping: VisualMapping =
        serde_json::from_slice(&mapping_bytes).context("failed to parse mapping JSON")?;

    let evo = EvoFile::open(&args.input)?;
    let total_frames = evo.total_frames();
    if total_frames == 0 {
        bail!("no frames found in {:?}", args.input);
    }

    let idx_x = evo
        .state_index(&mapping.position.x)
        .with_context(|| format!("missing state label for position.x: {}", mapping.position.x))?;
    let idx_y = evo
        .state_index(&mapping.position.y)
        .with_context(|| format!("missing state label for position.y: {}", mapping.position.y))?;

    let event_loop = EventLoop::new()?;
    let window = WindowBuilder::new()
        .with_title("Evolimo Visualizer")
        .build(&event_loop)?;
    let window: &'static winit::window::Window = Box::leak(Box::new(window));

    let mut renderer = pollster::block_on(Renderer::new(window))?;

    let mut frame_buf: Vec<f32> = Vec::new();
    let mut instances: Vec<Instance> = Vec::new();

    let n_agents = evo.header.config.n_agents;
    let state_dims = evo.header.config.state_dims;

    let frame_dt = Duration::from_secs_f64(1.0 / args.sim_fps);
    let start = Instant::now();
    let mut next_tick = start;

    let mut fps_window_start = Instant::now();
    let mut fps_frames: u32 = 0;
    let mut fps_last: f64 = 0.0;

    let mut title_last_update = Instant::now();
    let title_update_dt = Duration::from_millis(250);

    let mut last_drawn_frame: usize = usize::MAX;

    event_loop.run(move |event, elwt| {
        elwt.set_control_flow(ControlFlow::WaitUntil(next_tick));

        match event {
            Event::AboutToWait => {
                let now = Instant::now();
                if now >= next_tick {
                    next_tick = now + frame_dt;
                    window.request_redraw();
                }
            }
            Event::WindowEvent { event, .. } => match event {
                WindowEvent::CloseRequested => elwt.exit(),
                WindowEvent::Resized(size) => {
                    renderer.resize(size.width, size.height);
                }
                WindowEvent::RedrawRequested => {
                    fps_frames = fps_frames.saturating_add(1);
                    let now = Instant::now();
                    let fps_elapsed = now.duration_since(fps_window_start);
                    if fps_elapsed >= Duration::from_secs(1) {
                        let secs = fps_elapsed.as_secs_f64().max(1e-9);
                        fps_last = fps_frames as f64 / secs;
                        fps_frames = 0;
                        fps_window_start = now;
                    }

                    let elapsed = start.elapsed().as_secs_f64();
                    let desired = (elapsed * args.sim_fps) as usize;
                    let frame_index = desired.min(total_frames.saturating_sub(1));

                    if now.duration_since(title_last_update) >= title_update_dt {
                        window.set_title(&format!(
                            "Evolimo Visualizer | agents: {} | sim frame: {}/{} | fps: {:.1}",
                            n_agents,
                            frame_index,
                            total_frames.saturating_sub(1),
                            fps_last
                        ));
                        title_last_update = now;
                    }

                    if frame_index != last_drawn_frame {
                        if let Err(e) = evo.read_frame_f32(frame_index, &mut frame_buf) {
                            eprintln!("failed to read frame {frame_index}: {e:#}");
                            last_drawn_frame = frame_index;
                            return;
                        }

                        let w = renderer.config.width as f32;
                        let h = renderer.config.height as f32;
                        let cx = w * 0.5;
                        let cy = h * 0.5;

                        instances.clear();
                        instances.reserve(n_agents);

                        for i in 0..n_agents {
                            let base = i * state_dims;
                            let pos_x = frame_buf[base + idx_x];
                            let pos_y = frame_buf[base + idx_y];

                            let lookup = |label: &str| {
                                evo.state_index(label)
                                    .map(|j| frame_buf[base + j])
                            };

                            let mut radius_px = 2.0;
                            if let Some(size_map) = &mapping.size {
                                let raw = match eval_source(&size_map.source, &lookup) {
                                    Ok(v) => v,
                                    Err(_) => 0.0,
                                };
                                let t = normalize(raw, size_map.value_range);
                                let t = apply_scale(t, size_map.scale.as_deref()).unwrap_or(t);
                                radius_px = size_map.range[0]
                                    + t * (size_map.range[1] - size_map.range[0]);
                            }

                            let mut opacity = 1.0;
                            if let Some(op_map) = &mapping.opacity {
                                let raw = match eval_source(&op_map.source, &lookup) {
                                    Ok(v) => v,
                                    Err(_) => 0.0,
                                };
                                let t = normalize(raw, op_map.value_range);
                                opacity = op_map.range[0] + t * (op_map.range[1] - op_map.range[0]);
                                opacity = opacity.max(0.0).min(1.0);
                            }

                            let mut rgb = [255u8, 255u8, 255u8];
                            if let Some(color_map) = &mapping.color {
                                let raw = match eval_source(&color_map.source, &lookup) {
                                    Ok(v) => v,
                                    Err(_) => 0.0,
                                };
                                let t = normalize(raw, color_map.range);
                                rgb = colormap_rgb(&color_map.colormap, t).unwrap_or(rgb);
                            }

                            let center_px = [pos_x + cx, cy - pos_y];
                            let color = [
                                rgb[0] as f32 / 255.0,
                                rgb[1] as f32 / 255.0,
                                rgb[2] as f32 / 255.0,
                                opacity,
                            ];

                            instances.push(Instance {
                                center_px,
                                radius_px,
                                _pad0: 0.0,
                                color,
                            });
                        }

                        last_drawn_frame = frame_index;
                    }

                    if let Err(e) = renderer.render(&instances) {
                        eprintln!("render error: {e:#}");
                    }
                }
                _ => {}
            },
            _ => {}
        }
    })?;

    Ok(())
}
