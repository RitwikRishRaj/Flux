import * as Y from "yjs";
import YProvider from "y-partyserver/provider";
import type * as monacoNS from "monaco-editor";
import { byId } from "./compilers";

let PARTY_URL: string | undefined;

export function connect(
  roomId: string,
  editor: monacoNS.editor.IStandaloneCodeEditor,
  model: monacoNS.editor.ITextModel,
  user: { id: string; name: string; color: string },
  monaco: typeof monacoNS,
  editorId: string = "main"
) {
  PARTY_URL ??= process.env.NEXT_PUBLIC_PARTYKIT_URL;
  if (!PARTY_URL) throw new Error("Set NEXT_PUBLIC_PARTYKIT_URL");

  const doc = new Y.Doc();
  const ytext = doc.getText("monaco");
  const stdin = doc.getText("stdin");
  const roomState = doc.getMap<string>("roomState");
  const meta = doc.getMap<unknown>("meta");

  const provider = new YProvider(PARTY_URL, roomId, doc, {
    party: "main",
    connect: true
  });

  provider.awareness.setLocalStateField("user", {
    id: user.id,
    name: user.name || "Anonymous",
    color: user.color || "#5FD0A8"
  });

  // Inject per-client cursor styles (scoped to editor)
  const styleId = `flux-cursor-styles-${editorId}`;
  const renderCursorStyles = () => {
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    // Map clientId to user data (y-monaco uses clientId, not user.id)
    const clientStyles = new Map<number, { color: string; name: string }>();
    const localClientId = provider.awareness.clientID;
    
    provider.awareness.getStates().forEach((state: any, clientId: number) => {
      if (clientId !== localClientId && state.user) {
        clientStyles.set(clientId, {
          color: state.user.color || "#5FD0A8",
          name: state.user.name || "Anonymous"
        });
      }
    });

    const css = Array.from(clientStyles.entries()).map(([clientId, data], index) => {
      // Security: validate color format
      const color = /^#[0-9a-fA-F]{6}$/.test(data.color) ? data.color : "#5FD0A8";
      // Security: sanitize name
      const name = data.name.replace(/["\\<>\n]/g, "").slice(0, 24);
      // Contrast: pick text color based on background brightness
      const textColor = parseInt(color.slice(1), 16) > 0x7FFFFF ? "#000" : "#fff";
      
      return `.monaco-editor[data-editor="${editorId}"] .yRemoteSelection-${clientId} { background: ${color}33; }
.monaco-editor[data-editor="${editorId}"] .yRemoteSelectionHead-${clientId} { border-left: 2px solid ${color}; position: relative; }
.monaco-editor[data-editor="${editorId}"] .yRemoteSelectionHead-${clientId}::after { content: ""; position: absolute; top: -6px; left: -6px; right: -6px; bottom: -6px; }
.monaco-editor[data-editor="${editorId}"] .yRemoteSelectionHead-${clientId}::before { content: "${name}"; position: absolute; top: -14px; left: 8px; padding: 1px 5px; border-radius: 3px; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 500; white-space: nowrap; color: ${textColor}; background: ${color}; opacity: 0; pointer-events: none; z-index: 1; transition: opacity 0.15s ease; }
.monaco-editor[data-editor="${editorId}"] .yRemoteSelectionHead-${clientId}:hover::before { opacity: 1; }`;
    }).join("\n");

    styleEl.textContent = css;
  };

  provider.on("sync", () => {
    renderCursorStyles();
  });

  provider.awareness.on("change", renderCursorStyles);

  let binding: any;
  let seeded = false;

  provider.on("sync", () => {
    if (typeof window !== "undefined" && !model.isDisposed()) {
      import("y-monaco").then(({ MonacoBinding }) => {
        if (model.isDisposed()) return;
        binding = new MonacoBinding(ytext, model, new Set([editor]), provider.awareness);

        // Seed template on first sync if document is empty
        if (!seeded && ytext.length === 0) {
          doc.transact(() => {
            if (ytext.length === 0 && !meta.has("seeded")) {
              const compiler = byId(roomState.get("compilerId") || "python-3.14");
              ytext.insert(0, compiler.hello);
              meta.set("seeded", true);
              seeded = true;
            }
          });
        }
      }).catch(err => console.error("Failed to load MonacoBinding:", err));
    }
  });

  // Clean up awareness on pagehide to prevent ghosts
  const onUnload = () => provider.awareness.setLocalState(null);
  window.addEventListener("pagehide", onUnload);

  return [
    () => {
      window.removeEventListener("pagehide", onUnload);
      provider.awareness.setLocalState(null);
      binding?.destroy();
      provider.destroy();
    },
    // isSynced is still false while the server's saved state is being applied, so callers can tell history from live edits.
    {
      getRoomState: () => roomState, getAwareness: () => provider.awareness, getStdin: () => stdin, isSynced: () => provider.synced,
      // Runs cb once the server's saved state is in (right away if it already is). Returns an unsubscribe.
      whenSynced: (cb: () => void) => {
        if (provider.synced) { cb(); return () => {}; }
        const onSynced = (synced: boolean) => { if (synced) { provider.off("synced", onSynced); cb(); } };
        provider.on("synced", onSynced);
        return () => provider.off("synced", onSynced);
      }
    }
  ] as const;
}
