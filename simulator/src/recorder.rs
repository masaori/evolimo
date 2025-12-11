use std::{
    fs::File,
    io::{BufWriter, Write},
    path::Path,
};

use anyhow::{bail, Result};
use candle_core::Tensor;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const MAGIC_BYTES: &[u8; 4] = b"EVO1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EvoConfig {
    pub n_agents: usize,
    pub state_dims: usize,
    pub state_labels: Vec<String>,
    pub dt: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlaybackMeta {
    pub total_frames: usize,
    pub save_interval: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EvoHeader {
    pub version: u32,
    pub timestamp: String,
    pub config: EvoConfig,
    pub playback: PlaybackMeta,
}

impl EvoHeader {
    pub fn new(config: EvoConfig, playback: PlaybackMeta) -> Self {
        let now: DateTime<Utc> = Utc::now();
        Self {
            version: 1,
            timestamp: now.to_rfc3339(),
            config,
            playback,
        }
    }
}

pub struct EvoRecorder {
    writer: BufWriter<File>,
    header: EvoHeader,
    frame_stride: usize,
    frames_written: u64,
}

impl EvoRecorder {
    pub fn create<P: AsRef<Path>>(path: P, header: EvoHeader) -> Result<Self> {
        let file = File::create(path)?;
        let mut writer = BufWriter::new(file);
        let header_json = serde_json::to_vec(&header)?;
        let header_len = u32::try_from(header_json.len())
            .map_err(|_| anyhow::anyhow!("Header too large to encode length"))?;

        writer.write_all(MAGIC_BYTES)?;
        writer.write_all(&header_len.to_le_bytes())?;
        writer.write_all(&header_json)?;

        Ok(Self {
            writer,
            frame_stride: header.config.n_agents * header.config.state_dims,
            header,
            frames_written: 0,
        })
    }

    pub fn write_frame(&mut self, state: &Tensor) -> Result<()> {
        let dims = state.dims();
        if dims.len() != 2
            || dims[0] != self.header.config.n_agents
            || dims[1] != self.header.config.state_dims
        {
            bail!(
                "State shape mismatch. expected ({}, {}), got {:?}",
                self.header.config.n_agents,
                self.header.config.state_dims,
                dims
            );
        }

        let frame = state.to_vec2::<f32>()?;
        for row in frame.iter() {
            for value in row.iter() {
                self.writer.write_all(&value.to_le_bytes())?;
            }
        }

        self.frames_written += 1;
        Ok(())
    }

    pub fn flush(&mut self) -> Result<()> {
        self.writer.flush()?;
        Ok(())
    }

    pub fn frames_written(&self) -> u64 {
        self.frames_written
    }

    pub fn header(&self) -> &EvoHeader {
        &self.header
    }

    pub fn body_offset(&self) -> u64 {
        let header_json = serde_json::to_vec(&self.header).unwrap_or_default();
        (MAGIC_BYTES.len() + std::mem::size_of::<u32>() + header_json.len()) as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use candle_core::Device;
    use std::fs;

    #[test]
    fn writes_header_and_body() -> Result<()> {
        let tmp_path = std::env::temp_dir().join("evo_recorder_test.evo");
        if tmp_path.exists() {
            fs::remove_file(&tmp_path)?;
        }

        let header = EvoHeader::new(
            EvoConfig {
                n_agents: 2,
                state_dims: 3,
                state_labels: vec![
                    "pos_x".to_string(),
                    "vel_x".to_string(),
                    "energy".to_string(),
                ],
                dt: 0.1,
            },
            PlaybackMeta {
                total_frames: 1,
                save_interval: 1,
            },
        );

        let mut recorder = EvoRecorder::create(&tmp_path, header.clone())?;
        let device = Device::Cpu;
        let state = Tensor::from_slice(&[1f32, 2f32, 3f32, 4f32, 5f32, 6f32], (2, 3), &device)?;
        recorder.write_frame(&state)?;
        recorder.flush()?;

        let bytes = fs::read(&tmp_path)?;
        assert_eq!(&bytes[0..4], MAGIC_BYTES);

        let header_len = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        let header_json = std::str::from_utf8(&bytes[8..8 + header_len]).unwrap();
        let parsed: EvoHeader = serde_json::from_str(header_json).unwrap();
        assert_eq!(parsed, header);

        let body = &bytes[8 + header_len..];
        let mut values = Vec::new();
        for chunk in body.chunks_exact(4) {
            values.push(f32::from_le_bytes(chunk.try_into().unwrap()));
        }
        assert_eq!(values, vec![1., 2., 3., 4., 5., 6.]);

        fs::remove_file(&tmp_path)?;
        Ok(())
    }
}
