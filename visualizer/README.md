# Evolimo Visualizer Prototype

This prototype demonstrates how to read the `.evo` binary format produced by the simulator.

## Usage

```ts
import { parseEvoFile, sliceAgentState } from "./evoReader";

async function handleFile(file: File) {
  const evo = await parseEvoFile(file);
  console.log("Header", evo.header);

  // Lazy-load the first frame without loading the full file
  const frame0 = await evo.getFrame(0);

  // Read a single agent's state (pos_x, vel_x, energy)
  const agent0 = sliceAgentState(frame0, 0, evo.header);
  console.log("Agent0", agent0);
}
```

The parser only reads the requested frame via `Blob.slice`, so large `.evo` files can be streamed without loading the full file into memory. Each frame is returned as a `Float32Array` ready to upload directly to WebGL/WebGPU buffers.
