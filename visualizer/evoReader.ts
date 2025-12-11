export interface EvoConfig {
  n_agents: number;
  state_dims: number;
  state_labels: string[];
  dt: number;
}

export interface PlaybackMeta {
  total_frames: number;
  save_interval: number;
}

export interface EvoHeader {
  version: number;
  timestamp: string;
  config: EvoConfig;
  playback: PlaybackMeta;
}

export interface EvoFileHandle {
  header: EvoHeader;
  frameSizeBytes: number;
  bodyOffset: number;
  totalFramesAvailable: number;
  getFrame: (frameIndex: number) => Promise<Float32Array>;
}

const MAGIC = "EVO1";
const MAGIC_LEN = 4;
const HEADER_LEN_SIZE = 4;

let cachedLittleEndian: boolean | null = null;
function ensureLittleEndian() {
  if (cachedLittleEndian === null) {
    cachedLittleEndian =
      new Uint16Array(new Uint8Array([1, 0]).buffer)[0] === 1;
  }
  if (!cachedLittleEndian) {
    throw new Error(
      "Big-endian platforms are not supported (frames are stored as little-endian f32)."
    );
  }
}

export async function parseEvoFile(blob: Blob): Promise<EvoFileHandle> {
  ensureLittleEndian();

  const headerPrefix = new Uint8Array(
    await blob.slice(0, MAGIC_LEN + HEADER_LEN_SIZE).arrayBuffer()
  );

  const magic = new TextDecoder().decode(headerPrefix.slice(0, MAGIC_LEN));
  if (magic !== MAGIC) {
    throw new Error(`Invalid magic bytes: expected ${MAGIC}, got ${magic}`);
  }

  const headerLen = new DataView(headerPrefix.buffer).getUint32(
    MAGIC_LEN,
    true
  );
  const headerBytes = new Uint8Array(
    await blob.slice(MAGIC_LEN + HEADER_LEN_SIZE, MAGIC_LEN + HEADER_LEN_SIZE + headerLen).arrayBuffer()
  );
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as EvoHeader;

  const frameSizeBytes = header.config.n_agents * header.config.state_dims * 4;
  const bodyOffset = MAGIC_LEN + HEADER_LEN_SIZE + headerLen;
  const totalFramesAvailable = Math.floor(
    (blob.size - bodyOffset) / frameSizeBytes
  );

  return {
    header,
    frameSizeBytes,
    bodyOffset,
    totalFramesAvailable,
    async getFrame(frameIndex: number): Promise<Float32Array> {
      if (frameIndex < 0 || frameIndex >= totalFramesAvailable) {
        throw new Error(
          `Frame index ${frameIndex} out of bounds (0..${totalFramesAvailable - 1})`
        );
      }

      const start = bodyOffset + frameIndex * frameSizeBytes;
      const end = start + frameSizeBytes;
      const buffer = await blob.slice(start, end).arrayBuffer();
      return new Float32Array(buffer);
    },
  };
}

export function sliceAgentState(
  frame: Float32Array,
  agentIndex: number,
  header: EvoHeader
): Float32Array {
  const { state_dims, n_agents } = header.config;
  if (agentIndex < 0 || agentIndex >= n_agents) {
    throw new Error(`Agent index ${agentIndex} out of bounds (0..${n_agents - 1})`);
  }

  const start = agentIndex * state_dims;
  return frame.slice(start, start + state_dims);
}
