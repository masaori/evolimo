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
pub const MAX_HEADER_BYTES: u32 = 1_048_576; // 1 MB

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
    frame_buffer: Vec<u8>,
    frames_written: u64,
}

impl EvoRecorder {
    pub fn create<P: AsRef<Path>>(path: P, header: EvoHeader) -> Result<Self> {
        let file = File::create(path)?;
        let mut writer = BufWriter::new(file);
        let header_json = serde_json::to_vec(&header)?;
        if header_json.len() > MAX_HEADER_BYTES as usize {
            bail!(
                "Header too large to encode length (max {} bytes)",
                MAX_HEADER_BYTES
            );
        }
        let header_len = header_json.len() as u32;

        writer.write_all(MAGIC_BYTES)?;
        writer.write_all(&header_len.to_le_bytes())?;
        writer.write_all(&header_json)?;

        let capacity =
            header.config.n_agents * header.config.state_dims * std::mem::size_of::<f32>();

        Ok(Self {
            writer,
            header,
            frame_buffer: Vec::with_capacity(capacity),
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
                "Shape mismatch: expected ({}, {}), got {:?}",
                self.header.config.n_agents,
                self.header.config.state_dims,
                dims
            );
        }

        let frame = state.to_vec2::<f32>()?;
        let flat: Vec<f32> = frame.into_iter().flatten().collect();
        let byte_slice = unsafe {
            std::slice::from_raw_parts(
                flat.as_ptr() as *const u8,
                flat.len() * std::mem::size_of::<f32>(),
            )
        };

        self.frame_buffer.clear();
        self.frame_buffer.extend_from_slice(byte_slice);
        self.writer.write_all(&self.frame_buffer)?;

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
