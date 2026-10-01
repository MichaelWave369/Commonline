export interface Pcm16Audio {
  sampleRate: number;
  samples: Int16Array;
}

function readAscii(buffer: Buffer, start: number, length: number) {
  return buffer.toString("ascii", start, start + length);
}

export function parsePcm16Wav(buffer: Buffer): Pcm16Audio {
  if (
    buffer.length < 44 ||
    readAscii(buffer, 0, 4) !== "RIFF" ||
    readAscii(buffer, 8, 4) !== "WAVE"
  ) {
    throw new Error("VOICE_RENDERER_WAV_INVALID");
  }

  let offset = 12;
  let format:
    | {
        audioFormat: number;
        channels: number;
        sampleRate: number;
        bitsPerSample: number;
      }
    | undefined;
  let data: Buffer | undefined;

  while (offset + 8 <= buffer.length) {
    const id = readAscii(buffer, offset, 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;

    if (end > buffer.length) {
      throw new Error("VOICE_RENDERER_WAV_INVALID");
    }

    if (id === "fmt " && size >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14)
      };
    } else if (id === "data") {
      data = buffer.subarray(start, end);
    }

    offset = end + (size % 2);
  }

  if (
    !format ||
    !data ||
    format.audioFormat !== 1 ||
    format.bitsPerSample !== 16 ||
    format.channels < 1 ||
    format.sampleRate < 1
  ) {
    throw new Error("VOICE_RENDERER_WAV_UNSUPPORTED");
  }

  const frameBytes = format.channels * 2;
  const frameCount = Math.floor(data.length / frameBytes);
  const mono = new Int16Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    const base = frame * frameBytes;
    for (let channel = 0; channel < format.channels; channel += 1) {
      sum += data.readInt16LE(base + channel * 2);
    }
    mono[frame] = Math.round(sum / format.channels);
  }

  return {
    sampleRate: format.sampleRate,
    samples: mono
  };
}

export function resamplePcm16(
  audio: Pcm16Audio,
  targetSampleRate: number
): Int16Array {
  if (audio.sampleRate === targetSampleRate) {
    return new Int16Array(audio.samples);
  }
  if (audio.samples.length === 0) return new Int16Array();

  const length = Math.max(
    1,
    Math.round(
      (audio.samples.length * targetSampleRate) / audio.sampleRate
    )
  );
  const output = new Int16Array(length);
  const ratio = audio.sampleRate / targetSampleRate;

  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const left = Math.min(
      audio.samples.length - 1,
      Math.floor(position)
    );
    const right = Math.min(audio.samples.length - 1, left + 1);
    const fraction = position - left;
    output[i] = Math.round(
      audio.samples[left]! * (1 - fraction) +
        audio.samples[right]! * fraction
    );
  }

  return output;
}

export function linearPcmToMulaw(sample: number) {
  const BIAS = 0x84;
  const CLIP = 32635;
  let value = Math.max(-32768, Math.min(32767, sample));
  let sign = (value >> 8) & 0x80;

  if (sign !== 0) value = -value;
  if (value > CLIP) value = CLIP;
  value += BIAS;

  let exponent = 7;
  for (
    let mask = 0x4000;
    exponent > 0 && (value & mask) === 0;
    exponent -= 1, mask >>= 1
  ) {
    // Find the highest significant segment.
  }

  const mantissa = (value >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

export function pcm16ToPcmu(samples: Int16Array) {
  const output = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    output[i] = linearPcmToMulaw(samples[i]!);
  }
  return output;
}

export function buildPcmuRtpPacket(input: {
  payload: Uint8Array;
  sequence: number;
  timestamp: number;
  ssrc: number;
  marker?: boolean;
  payloadType?: number;
}) {
  const packet = Buffer.allocUnsafe(12 + input.payload.length);
  packet[0] = 0x80;
  packet[1] =
    (input.marker ? 0x80 : 0) | (input.payloadType ?? 0);
  packet.writeUInt16BE(input.sequence & 0xffff, 2);
  packet.writeUInt32BE(input.timestamp >>> 0, 4);
  packet.writeUInt32BE(input.ssrc >>> 0, 8);
  Buffer.from(input.payload).copy(packet, 12);
  return packet;
}
