import * as Y from "yjs";
import YProvider from "y-partyserver/provider";
import type * as monacoNS from "monaco-editor";

let PARTY_URL: string | undefined;

export function connect(
  roomId: string,
  editor: monacoNS.editor.IStandaloneCodeEditor,
  model: monacoNS.editor.ITextModel,
  user: { name: string; color: string },
  monaco: typeof monacoNS
) {
  PARTY_URL ??= process.env.NEXT_PUBLIC_PARTYKIT_URL;
  if (!PARTY_URL) throw new Error("Set NEXT_PUBLIC_PARTYKIT_URL");

  const doc = new Y.Doc();
  const ytext = doc.getText("monaco");
  const roomState = doc.getMap<string>("roomState");

  const provider = new YProvider(PARTY_URL, roomId, doc, {
    party: "main",
    connect: true
  });

  provider.awareness.setLocalStateField("user", {
    name: user.name || "Anonymous",
    color: user.color || "#5FD0A8"
  });

  let binding: any;

  provider.on("sync", () => {
    if (typeof window !== "undefined") {
      import("y-monaco").then(({ MonacoBinding }) => {
        binding = new MonacoBinding(ytext, model, new Set([editor]), provider.awareness);
      }).catch(err => console.error("Failed to load MonacoBinding:", err));
    }
  });

  return [
    () => {
      binding?.destroy();
      provider.destroy();
    },
    { getRoomState: () => roomState, getAwareness: () => provider.awareness }
  ] as const;
}
