use std::{
    collections::HashMap,
    fs::File,
    path::{Path, PathBuf},
};

use anyhow::{anyhow, bail, Context, Result};
use memmap2::Mmap;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct EvoConfig {
    pub n_agents: usize,
    pub state_dims: usize,
    pub state_labels: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EvoHeader {
    #[allow(dead_code)]
    pub version: u32,
    #[allow(dead_code)]
    pub timestamp: String,
    pub config: EvoConfig,
}

pub struct EvoFile {
    _path: PathBuf,
    mmap: Mmap,
    pub header: EvoHeader,
    body_offset: usize,
    frame_bytes: usize,
    label_to_index: HashMap<String, usize>,
}

impl EvoFile {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let file = File::open(&path).with_context(|| format!("failed to open {:?}", path))?;
        let mmap = unsafe { Mmap::map(&file).context("failed to mmap file")? };

        if mmap.len() < 8 {
            bail!("file too small");
        }
        if &mmap[0..4] != b"EVO1" {
            bail!("invalid magic bytes (expected EVO1)");
        }
        let header_len = u32::from_le_bytes(mmap[4..8].try_into().unwrap()) as usize;
        let header_start: usize = 8;
        let header_end = header_start
            .checked_add(header_len)
            .ok_or_else(|| anyhow!("header length overflow"))?;
        if header_end > mmap.len() {
            bail!("header exceeds file length");
        }
        let header: EvoHeader =
            serde_json::from_slice(&mmap[header_start..header_end]).context("invalid header JSON")?;

        let frame_bytes = header.config
            .n_agents
            .checked_mul(header.config.state_dims)
            .and_then(|n| n.checked_mul(std::mem::size_of::<f32>()))
            .ok_or_else(|| anyhow!("frame size overflow"))?;
        if frame_bytes == 0 {
            bail!("invalid frame size (0)");
        }

        let mut label_to_index = HashMap::new();
        for (idx, label) in header.config.state_labels.iter().enumerate() {
            label_to_index.insert(label.clone(), idx);
        }

        Ok(Self {
            _path: path,
            mmap,
            header,
            body_offset: header_end,
            frame_bytes,
            label_to_index,
        })
    }

    pub fn total_frames_available(&self) -> usize {
        let body_len = self.mmap.len().saturating_sub(self.body_offset);
        body_len / self.frame_bytes
    }

    pub fn total_frames(&self) -> usize {
        self.total_frames_available()
    }

    pub fn state_index(&self, label: &str) -> Option<usize> {
        self.label_to_index.get(label).copied()
    }

    /// Returns a freshly decoded frame as little-endian f32 values.
    pub fn read_frame_f32(&self, frame_index: usize, out: &mut Vec<f32>) -> Result<()> {
        let total = self.total_frames();
        if total == 0 {
            bail!("no frames available");
        }
        if frame_index >= total {
            bail!("frame_index out of range: {frame_index} >= {total}");
        }

        let start = self
            .body_offset
            .checked_add(frame_index * self.frame_bytes)
            .ok_or_else(|| anyhow!("frame offset overflow"))?;
        let end = start + self.frame_bytes;
        let bytes = &self.mmap[start..end];

        let n_f32 = self.header.config.n_agents * self.header.config.state_dims;
        out.clear();
        out.reserve(n_f32);
        for chunk in bytes.chunks_exact(4) {
            out.push(f32::from_le_bytes(chunk.try_into().unwrap()));
        }
        Ok(())
    }
}
