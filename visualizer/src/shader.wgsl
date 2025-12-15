struct Uniforms {
  screen_size: vec2<f32>,
  _pad: vec2<f32>,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

struct VsIn {
  @location(0) pos: vec2<f32>,
  @location(1) center_px: vec2<f32>,
  @location(2) radius_px: f32,
  @location(3) color: vec4<f32>,
};

struct VsOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) color: vec4<f32>,
};

@vertex
fn vs_main(input: VsIn) -> VsOut {
  let pos_px = input.center_px + input.pos * input.radius_px;

  let ndc_x = (pos_px.x / u.screen_size.x) * 2.0 - 1.0;
  let ndc_y = 1.0 - (pos_px.y / u.screen_size.y) * 2.0;

  var out: VsOut;
  out.clip_pos = vec4<f32>(ndc_x, ndc_y, 0.0, 1.0);
  out.local = input.pos;
  out.color = input.color;
  return out;
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
  if (dot(input.local, input.local) > 1.0) {
    discard;
  }
  return input.color;
}
