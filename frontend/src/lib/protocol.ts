// Shared encoding/decoding utilities for Yjs protocol
import { encoding, decoding } from "lib0";

export const { createEncoder, writeVarUint, toUint8Array, writeVarUint8Array } = encoding;
export const { createDecoder, readVarUint, readVarUint8Array } = decoding;

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

export function encodeSync(update: Uint8Array): Uint8Array {
  const encoder = createEncoder();
  writeVarUint(encoder, MESSAGE_SYNC);
  writeVarUint8Array(encoder, update);
  return toUint8Array(encoder);
}

export function encodeAwareness(update: Uint8Array): Uint8Array {
  const encoder = createEncoder();
  writeVarUint(encoder, MESSAGE_AWARENESS);
  writeVarUint8Array(encoder, update);
  return toUint8Array(encoder);
}

export function decodeMessage(data: Uint8Array): { type: number; update: Uint8Array } {
  const decoder = createDecoder(data);
  const type = readVarUint(decoder);
  const update = readVarUint8Array(decoder);
  return { type, update };
}
