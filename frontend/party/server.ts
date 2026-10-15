// PartyKit server for Flux rooms. Handles Yjs document sync + awareness.
import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { encodeSync, encodeAwareness, decodeMessage } from "../src/lib/protocol";
import type * as Party from "partykit/server";

export default class FluxRoom implements Party.Server {
  doc = new Y.Doc();
  awareness = new Awareness(this.doc);
  connections = new Set<Party.Connection>();
  clientIDs = new Map<Party.Connection, number>();

  constructor(readonly party: Party.Party) {}

  async onStart() {
    // Load persisted document from storage
    const persisted = await this.party.storage.get<Uint8Array>("doc");
    if (persisted) {
      Y.applyUpdate(this.doc, persisted);
    }
  }

  onConnect(conn: Party.Connection, opts: Party.ConnectionContext) {
    this.connections.add(conn);
    (conn.socket as any).binaryType = "arraybuffer";

    // Track client ID for cleanup
    this.clientIDs.set(conn, this.doc.clientID);

    // Send initial sync
    conn.socket.send(encodeSync(Y.encodeStateAsUpdate(this.doc)));

    // Send current awareness states
    conn.socket.send(encodeAwareness(encodeAwarenessUpdate(this.awareness, Array.from(this.awareness.getStates().keys()))));

    conn.socket.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) {
        const { type, update } = decodeMessage(new Uint8Array(event.data));

        if (type === 0) { // MESSAGE_SYNC
          Y.applyUpdate(this.doc, update);
          this.party.storage.put("doc", Y.encodeStateAsUpdate(this.doc));
          this.broadcast(update, conn, 0);
        } else if (type === 1) { // MESSAGE_AWARENESS
          applyAwarenessUpdate(this.awareness, update, null);
          this.broadcast(update, conn, 1);
        }
      }
    });

    conn.socket.addEventListener("close", () => {
      this.connections.delete(conn);
      // Immediate cleanup of ghost cursor
      const clientID = this.clientIDs.get(conn);
      if (clientID !== undefined) {
        removeAwarenessStates(this.awareness, [clientID], "disconnected");
        this.clientIDs.delete(conn);
      }
    });
  }

  broadcast(update: Uint8Array, sender: Party.Connection, messageType: number) {
    const message = messageType === 0 ? encodeSync(update) : encodeAwareness(update);
    for (const conn of this.connections) if (conn !== sender) conn.socket.send(message);
  }
}
