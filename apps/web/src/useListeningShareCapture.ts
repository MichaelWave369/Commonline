import { useCallback, useEffect, useRef, useState } from "react";
import type { ListeningShareLease } from "@commonline/protocol";
import { mediaContextLabel } from "./transportSecurity";

type CaptureState =
  | "idle"
  | "capturing"
  | "encoding"
  | "submitted"
  | "failed";

function flattenFloatChunks(chunks: Float32Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Float32Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

function resampleFloat32(
  input: Float32Array,
  inputRate: number,
  outputRate: number
) {
  if (input.length === 0) return new Float32Array();
  if (inputRate === outputRate) return new Float32Array(input);

  const outputLength = Math.max(
    1,
    Math.round((input.length * outputRate) / inputRate)
  );
  const output = new Float32Array(outputLength);
  const ratio = inputRate / outputRate;

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[index] =
      input[left]! * (1 - fraction) + input[right]! * fraction;
  }

  return output;
}

function float32ToPcm16(input: Float32Array) {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]!));
    output[index] =
      sample < 0
        ? Math.round(sample * 32768)
        : Math.round(sample * 32767);
  }
  return output;
}

function pcm16ToBase64(samples: Int16Array) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);

  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(index * 2, samples[index]!, true);
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize)
    );
  }
  return btoa(binary);
}

export function useListeningShareCapture(input: {
  lease: ListeningShareLease | null;
  agentParticipantId: string;
  submit: (
    agentParticipantId: string,
    leaseId: string,
    pcm16Base64: string,
    sampleCount: number
  ) => boolean;
}) {
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const timeoutRef = useRef<number | null>(null);

  const [state, setState] = useState<CaptureState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const leaseIdRef = useRef<string | null>(null);

  const cleanup = useCallback(async () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (elapsedTimerRef.current !== null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }

    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    gainRef.current?.disconnect();

    processorRef.current = null;
    sourceRef.current = null;
    gainRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") {
      await context.close();
    }

    startedAtRef.current = null;
  }, []);

  const stopAndSubmit = useCallback(async () => {
    if (state !== "capturing") return false;
    setState("encoding");

    const inputRate = contextRef.current?.sampleRate ?? 48000;
    const chunks = chunksRef.current;
    chunksRef.current = [];

    await cleanup();

    try {
      const flattened = flattenFloatChunks(chunks);
      const resampled = resampleFloat32(flattened, inputRate, 16000);
      const pcm16 = float32ToPcm16(resampled);

      if (pcm16.length < 1600) {
        throw new Error(
          "Capture at least 0.1 seconds before sharing with Vessie."
        );
      }

      const maxSamples = 80000;
      const bounded =
        pcm16.length > maxSamples
          ? pcm16.subarray(0, maxSamples)
          : pcm16;

      const lease = input.lease;
      if (!lease || lease.state !== "active") {
        throw new Error(
          "The listening-share lease is no longer active."
        );
      }

      const sent = input.submit(
        input.agentParticipantId,
        lease.leaseId,
        pcm16ToBase64(bounded),
        bounded.length
      );
      if (!sent) {
        throw new Error(
          "Commonline signaling disconnected before the listening share could be submitted."
        );
      }

      setElapsedMs(
        Math.round((bounded.length / 16000) * 1000)
      );
      setState("submitted");
      setError(null);
      return true;
    } catch (cause) {
      setState("failed");
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not submit the bounded listening share."
      );
      return false;
    }
  }, [cleanup, input, state]);

  const stopRef = useRef(stopAndSubmit);
  stopRef.current = stopAndSubmit;

  const start = useCallback(async () => {
    if (
      !input.lease ||
      input.lease.state !== "active" ||
      state === "capturing"
    ) {
      return false;
    }

    if (
      mediaContextLabel({
        pageUrl: window.location.href,
        secureContext: window.isSecureContext
      }) !== "secure"
    ) {
      setError("Microphone sharing requires HTTPS or localhost.");
      setState("failed");
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        video: false
      });
      const context = new AudioContext();
      await context.resume();

      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const gain = context.createGain();
      gain.gain.value = 0;

      chunksRef.current = [];
      processor.onaudioprocess = (event) => {
        const channel = event.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(channel));
      };

      source.connect(processor);
      processor.connect(gain);
      gain.connect(context.destination);

      streamRef.current = stream;
      contextRef.current = context;
      sourceRef.current = source;
      processorRef.current = processor;
      gainRef.current = gain;

      startedAtRef.current = performance.now();
      setElapsedMs(0);
      elapsedTimerRef.current = window.setInterval(() => {
        if (startedAtRef.current !== null) {
          setElapsedMs(
            Math.round(performance.now() - startedAtRef.current)
          );
        }
      }, 100);

      const maxDuration = Math.min(
        5000,
        input.lease.maxDurationMs
      );
      timeoutRef.current = window.setTimeout(() => {
        void stopRef.current();
      }, maxDuration);

      setError(null);
      setState("capturing");
      return true;
    } catch (cause) {
      await cleanup();
      setState("failed");
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not open the microphone for bounded sharing."
      );
      return false;
    }
  }, [cleanup, input.lease, state]);

  const cancel = useCallback(async () => {
    chunksRef.current = [];
    await cleanup();
    setElapsedMs(0);
    setError(null);
    setState("idle");
  }, [cleanup]);

  useEffect(() => {
    const leaseId = input.lease?.leaseId ?? null;
    if (leaseId && leaseId !== leaseIdRef.current) {
      leaseIdRef.current = leaseId;
      chunksRef.current = [];
      setState("idle");
      setElapsedMs(0);
      setError(null);
    } else if (!leaseId) {
      leaseIdRef.current = null;
    }
  }, [input.lease?.leaseId]);

  useEffect(() => {
    if (input.lease?.state === "active") return;
    if (state === "capturing") {
      void cancel();
    }
  }, [cancel, input.lease?.state, state]);

  useEffect(
    () => () => {
      void cleanup();
    },
    [cleanup]
  );

  return {
    state,
    elapsedMs,
    error,
    capturing: state === "capturing",
    start,
    stopAndSubmit,
    cancel
  };
}
