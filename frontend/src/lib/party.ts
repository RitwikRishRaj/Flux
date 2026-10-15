// Client-only MonacoBinding wrapper to avoid webpack issues
import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from "y-protocols/awareness";
import { createEncoder, writeVarUint, toUint8Array, writeVarUint8Array, createDecoder, readVarUint, readVarUint8Array } from "./protocol";
import { MESSAGE_SYNC, MESSAGE_AWARENESS } from "./protocol";
import type * as monacoNS from "monaco-editor";

const PARTYKIT_URL = process.env.NEXT_PUBLIC_PARTYKIT_URL;
if (!PARTYKIT_URL) throw new Error("Set NEXT_PUBLIC_PARTYKIT_URL");

export function connect(
  roomId: string,
  editor: monacoNS.editor.IStandaloneCodeEditor,
  model: monacoNS.editor.ITextModel,
  user: { name: string; color: string }
) {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const ytext = doc.getText("monaco");
  const roomState = doc.getMap<string>("roomState");

  // Set initial user awareness
  awareness.setLocalStateField("user", {
    name: user.name || "Anonymous",
    color: user.color || "#5FD0A8",
    cursor: null
  });

  const ws = new WebSocket(`${PARTYKIT_URL}/party/${roomId}`);
  ws.binaryType = "arraybuffer";

  // Queue messages until MonacoBinding is ready
  const pending: ArrayBuffer[] = [];
  let binding: any;
  let ready = false;

  const processMessage = (data: ArrayBuffer) => {
    const decoder = createDecoder(new Uint8Array(data));
    const messageType = readVarUint(decoder);

    if (messageType === MESSAGE_SYNC) {
      Y.applyUpdate(doc, readVarUint8Array(decoder));
    } else if (messageType === MESSAGE_AWARENESS) {
      applyAwarenessUpdate(awareness, readVarUint8Array(decoder), null);
    }
  };

  const sendSync = (update: Uint8Array) => {
    if (ws.readyState === WebSocket.OPEN) {
      const encoder = createEncoder();
      writeVarUint(encoder, MESSAGE_SYNC);
      writeVarUint8Array(encoder, update);
      ws.send(toUint8Array(encoder));
    }
  };

  const sendAwareness = (update: Uint8Array) => {
    if (ws.readyState === WebSocket.OPEN) {
      const encoder = createEncoder();
      writeVarUint(encoder, MESSAGE_AWARENESS);
      writeVarUint8Array(encoder, update);
      ws.send(toUint8Array(encoder));
    }
  };

  ws.onopen = () => {
    // MonacoBinding - load dynamically only on client
    if (typeof window !== 'undefined') {
      // @ts-ignore - dynamically loaded
      const { MonacoBinding } = require('y-monaco');
      binding = new MonacoBinding(ytext, model, new Set([editor]), awareness);
      ready = true;
      
      // Send initial awareness on connect
      sendAwareness(encodeAwarenessUpdate(awareness, [doc.clientID]));
      
      // Process queued messages
      pending.forEach(msg => processMessage(msg));
      pending.length = 0;

      // Sync cursor position to awareness state
      editor.onDidChangeCursorPosition((e) => {
        awareness.setLocalStateField("user", {
          ...awareness.getLocalState()?.user,
          cursor: {
            line: e.position.lineNumber,
            column: e.position.column
          }
        });
        sendAwareness(encodeAwarenessUpdate(awareness, [doc.clientID]));
      });
    }
  };

  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      if (ready) {
        processMessage(event.data);
      } else {
        pending.push(event.data);
      }
    }
  };

  ws.onerror = () => {
    console.error("WebSocket connection error");
  };

  const observer = () => {
    sendSync(Y.encodeStateAsUpdate(doc));
  };

  doc.on("update", observer);

  // Awareness change: send full state on any change
  awareness.on("change", () => {
    sendAwareness(encodeAwarenessUpdate(awareness, [doc.clientID]));
  });

  return [
    () => {
      doc.off("update", observer);
      awareness.destroy();
      binding?.destroy();
      ws.close();
    },
    { getRoomState: () => roomState, getAwareness: () => awareness }
  ] as const;
}
