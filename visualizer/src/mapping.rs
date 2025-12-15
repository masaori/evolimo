use anyhow::{bail, Result};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BlendMode {
    Add,
    Average,
    Max,
    Min,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum VisualSource {
    Single(String),
    Multi {
        sources: Vec<String>,
        #[serde(default)]
        weights: Option<Vec<f32>>,
        #[serde(default)]
        blend: Option<BlendMode>,
    },
}

#[derive(Debug, Clone, Deserialize)]
pub struct SizeMapping {
    pub source: VisualSource,
    #[serde(default, rename = "valueRange")]
    pub value_range: Option<[f32; 2]>,
    pub range: [f32; 2],
    #[serde(default)]
    pub scale: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ColorMapping {
    pub source: VisualSource,
    pub colormap: String,
    #[serde(default)]
    pub range: Option<[f32; 2]>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OpacityMapping {
    pub source: VisualSource,
    #[serde(default, rename = "valueRange")]
    pub value_range: Option<[f32; 2]>,
    pub range: [f32; 2],
}

#[derive(Debug, Clone, Deserialize)]
pub struct VisualMapping {
    pub position: PositionMapping,
    #[serde(default)]
    pub size: Option<SizeMapping>,
    #[serde(default)]
    pub color: Option<ColorMapping>,
    #[serde(default)]
    pub opacity: Option<OpacityMapping>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PositionMapping {
    pub x: String,
    pub y: String,
}

pub fn clamp01(v: f32) -> f32 {
    v.max(0.0).min(1.0)
}

pub fn normalize(v: f32, range: Option<[f32; 2]>) -> f32 {
    let Some([min, max]) = range else {
        return clamp01(v);
    };
    if max <= min {
        return 0.0;
    }
    clamp01((v - min) / (max - min))
}

pub fn apply_scale(mut t: f32, scale: Option<&str>) -> Result<f32> {
    t = clamp01(t);
    let Some(scale) = scale else {
        return Ok(t);
    };
    match scale {
        "linear" => Ok(t),
        "sqrt" => Ok(t.sqrt()),
        "log" => {
            // Map [0,1] -> [0,1] with a gentle log curve.
            let k = 9.0;
            Ok(((1.0 + k * t).ln()) / (1.0 + k).ln())
        }
        other => bail!("unknown scale: {other}"),
    }
}

pub fn eval_source(
    source: &VisualSource,
    lookup: &impl Fn(&str) -> Option<f32>,
) -> Result<f32> {
    match source {
        VisualSource::Single(name) => Ok(lookup(name).unwrap_or(0.0)),
        VisualSource::Multi {
            sources,
            weights,
            blend,
        } => {
            if sources.is_empty() {
                return Ok(0.0);
            }
            let vals: Vec<f32> = sources
                .iter()
                .map(|s| lookup(s).unwrap_or(0.0))
                .collect();

            let blend = blend.clone().unwrap_or(BlendMode::Average);
            match blend {
                BlendMode::Max => Ok(vals
                    .into_iter()
                    .fold(f32::NEG_INFINITY, |a, b| a.max(b))),
                BlendMode::Min => Ok(vals.into_iter().fold(f32::INFINITY, |a, b| a.min(b))),
                BlendMode::Add | BlendMode::Average => {
                    let n = vals.len();
                    let w: Vec<f32> = match weights {
                        Some(w) if w.len() == n => w.clone(),
                        _ => vec![1.0 / n as f32; n],
                    };
                    let mut sum = 0.0;
                    let mut wsum = 0.0;
                    for (v, wi) in vals.into_iter().zip(w.into_iter()) {
                        sum += v * wi;
                        wsum += wi;
                    }
                    if matches!(blend, BlendMode::Average) {
                        if wsum == 0.0 {
                            Ok(0.0)
                        } else {
                            Ok(sum / wsum)
                        }
                    } else {
                        Ok(sum)
                    }
                }
            }
        }
    }
}
