import { describe, expect, it } from "vitest";
import {
  buildPcmuRtpPacket,
  linearPcmToMulaw,
  parsePcm16Wav,
  pcm16ToPcmu,
  resamplePcm16
} from "./audioPcm";

function wav16Mono(sampleRate: number, samples: Int16Array) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  samples.forEach((sample, index) => {
    buffer.writeInt16LE(sample, 44 + index * 2);
  });
  return buffer;
}

describe("P0-n audio packetization", () => {
  it("parses PCM16 WAV and resamples to 8 kHz", () => {
    const source = Int16Array.from([0, 1000, -1000, 2000]);
    const parsed = parsePcm16Wav(wav16Mono(16000, source));
    expect(parsed.sampleRate).toBe(16000);
    expect([...parsed.samples]).toEqual([...source]);

    const downsampled = resamplePcm16(parsed, 8000);
    expect(downsampled.length).toBe(2);
  });

  it("encodes PCM to PCMU bytes", () => {
    expect(linearPcmToMulaw(0)).toBe(255);
    const encoded = pcm16ToPcmu(
      Int16Array.from([0, 1000, -1000])
    );
    expect(encoded).toHaveLength(3);
    expect(encoded[0]).toBe(255);
    expect(encoded[1]).not.toBe(encoded[2]);
  });

  it("builds an RTP v2 PCMU packet with exact sequence and timestamp", () => {
    const packet = buildPcmuRtpPacket({
      payload: Uint8Array.from([1, 2, 3]),
      sequence: 42,
      timestamp: 123456,
      ssrc: 987654,
      marker: true
    });

    expect(packet[0]).toBe(0x80);
    expect(packet[1]).toBe(0x80);
    expect(packet.readUInt16BE(2)).toBe(42);
    expect(packet.readUInt32BE(4)).toBe(123456);
    expect(packet.readUInt32BE(8)).toBe(987654);
    expect([...packet.subarray(12)]).toEqual([1, 2, 3]);
  });
});
