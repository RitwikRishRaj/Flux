"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type * as Y from "yjs";
import { ExternalLink, Maximize2, Minimize2, Minus, Plus, RotateCw } from "lucide-react";
import { FLUX_THEME } from "@/lib/flux-monaco";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const FILES = [
  { key: "html", label: "index.html", lang: "html", seed: '<main>\n  <h1>Hello from Flux</h1>\n  <button id="b">Click</button>\n</main>' },
  { key: "css", label: "style.css", lang: "css", seed: "body {\n  font-family: system-ui, sans-serif;\n  padding: 2rem;\n}" },
  { key: "js", label: "script.js", lang: "javascript", seed: 'document.getElementById("b").onclick = () => alert("Hi");' },
] as const;
type FileKey = (typeof FILES)[number]["key"];

const ZOOM_MIN = 25, ZOOM_MAX = 200, ZOOM_STEP = 25;
const ICON_BTN = "flex h-8 w-8 items-center justify-center rounded-full text-primary/60 transition-colors duration-300 hover:bg-white/[0.06] hover:text-primary active:scale-95 disabled:pointer-events-none disabled:opacity-30";

// A literal "</script" or "</style" in user code would close the tag early and spill the rest as HTML.
export const buildSrcDoc = (html: string, css: string, js: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${css.replace(/<\/style/gi, "<\\/style")}</style></head>` +
  `<body>${html}<script>${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;

// The new tab is a blob page at the app's origin, so user code must stay inside a sandboxed iframe there too.
export const buildPreviewPage = (srcDoc: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Flux preview</title>` +
  `<style>html,body{margin:0;height:100%}iframe{display:block;border:0;width:100%;height:100%}</style></head>` +
  `<body><iframe sandbox="allow-scripts allow-modals allow-forms" srcdoc="${srcDoc.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe></body></html>`;

export function WebStudio({ doc, awareness, whenSynced }: { doc: Y.Doc; awareness: any; whenSynced: (cb: () => void) => () => void }) {
  const [file, setFile] = useState<FileKey>("html");
  const [srcDoc, setSrcDoc] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const openInNewTab = () => {
    const url = URL.createObjectURL(new Blob([buildPreviewPage(srcDoc)], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    // shortcut: the tab is a snapshot of this moment, not live; use a BroadcastChannel if live tabs are wanted.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const text = (k: FileKey) => doc.getText(`web-${k}`);

  useEffect(() => {
    // Starters only for an empty canvas, and only after the saved files arrive; seeding earlier merged them into real code.
    const stopWaiting = whenSynced(() => doc.transact(() => {
      if (FILES.every(f => text(f.key).length === 0)) FILES.forEach(f => text(f.key).insert(0, f.seed));
    }));

    let t: ReturnType<typeof setTimeout>;
    const render = () => setSrcDoc(buildSrcDoc(text("html").toString(), text("css").toString(), text("js").toString()));
    const onChange = () => { clearTimeout(t); t = setTimeout(render, 300); };
    render();
    FILES.forEach(f => text(f.key).observe(onChange));
    return () => {
      stopWaiting();
      clearTimeout(t);
      FILES.forEach(f => text(f.key).unobserve(onChange));
    };
  }, [doc]);

  const current = FILES.find(f => f.key === file)!;

  return (
    <div className="flux-enter flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
      {/* min-w-0: Monaco pins its pixel width, so without it the editor never shrinks back after the preview un-expands. */}
      <div className="min-h-0 min-w-0 flex-1 rounded-[1.6rem] bg-white/[0.03] p-1.5 ring-1 ring-inset ring-white/[0.08]">
        <div className="flex h-full flex-col overflow-hidden rounded-[calc(1.6rem-0.375rem)] bg-[#0B0B0A]">
          <div role="tablist" aria-label="Files" className="flex h-10 shrink-0 items-center gap-1 px-2">
            {FILES.map(f => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={file === f.key}
                onClick={() => setFile(f.key)}
                className={`h-8 rounded-full px-3 font-mono text-[13px] transition-colors duration-300 ${file === f.key ? "bg-white/[0.06] text-primary" : "text-primary/50 hover:text-primary"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="min-h-[16rem] flex-1">
            <Editor
              key={file}
              language={current.lang}
              theme="flux"
              beforeMount={monaco => monaco.editor.defineTheme("flux", FLUX_THEME)}
              onMount={editor => {
                // Reuses the cursor colours that lib/party.ts injects for the "main" editor.
                editor.getDomNode()?.setAttribute("data-editor", "main");
                const model = editor.getModel();
                if (!model) return;
                // No manual destroy: unmounting disposes the model, and the binding destroys itself on that.
                import("y-monaco").then(({ MonacoBinding }) => {
                  if (!model.isDisposed()) new MonacoBinding(text(file), model, new Set([editor]), awareness);
                });
              }}
              options={{
                fontSize: 14,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                minimap: { enabled: false },
                padding: { top: 4, bottom: 16 },
                scrollBeyondLastLine: false,
                stickyScroll: { enabled: false },
              }}
            />
          </div>
        </div>
      </div>

      {/* `layout` animates the pane between its slot and the overlay, both ways. */}
      <motion.section
        layout
        transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
        aria-label="Live preview"
        className={`flex flex-col rounded-[1.6rem] p-1.5 ring-1 ring-inset ring-white/[0.08] ${expanded ? "fixed inset-2 z-50 bg-ground md:inset-3" : "min-h-[20rem] min-w-0 flex-1 bg-white/[0.03]"}`}
      >
        <div className="flex h-10 shrink-0 items-center gap-0.5 pl-3 pr-1">
          <span className="mr-auto text-[13px] text-primary/50">Preview</span>
          <button type="button" onClick={() => setZoom(z => Math.max(ZOOM_MIN, z - ZOOM_STEP))} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out" className={ICON_BTN}>
            <Minus className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button type="button" onClick={() => setZoom(100)} aria-label="Reset zoom" title="Reset to 100%" className="h-8 w-12 rounded-full text-[13px] tabular-nums text-primary/70 transition-colors duration-300 hover:bg-white/[0.06] hover:text-primary">
            {zoom}%
          </button>
          <button type="button" onClick={() => setZoom(z => Math.min(ZOOM_MAX, z + ZOOM_STEP))} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in" className={ICON_BTN}>
            <Plus className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button type="button" onClick={() => setReloadKey(k => k + 1)} aria-label="Reload preview" className={ICON_BTN}>
            <RotateCw className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button type="button" onClick={() => setExpanded(x => !x)} aria-label={expanded ? "Collapse preview" : "Expand preview"} title={expanded ? "Back to split view (Esc)" : "Expand preview"} className={ICON_BTN}>
            {expanded ? <Minimize2 className="h-4 w-4" strokeWidth={1.5} /> : <Maximize2 className="h-4 w-4" strokeWidth={1.5} />}
          </button>
          <button type="button" onClick={openInNewTab} aria-label="Open preview in new tab" title="Open in new tab" className={ICON_BTN}>
            <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-[calc(1.6rem-0.375rem)] bg-white">
          {/* allow-scripts without allow-same-origin: user JS runs in an opaque origin, away from the app's storage and cookies. */}
          {/* Zoom = scale down/up and enlarge/shrink the box by the inverse, so the page lays out at the new effective viewport. */}
          {/* Mount only once there is HTML: Chrome drops the first srcdoc change on a sandboxed frame created empty. */}
          {srcDoc && <iframe
            key={reloadKey}
            title="Live preview"
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-modals allow-forms"
            className="block origin-top-left border-0"
            style={{ width: `${10000 / zoom}%`, height: `${10000 / zoom}%`, transform: `scale(${zoom / 100})` }}
          />}
        </div>
      </motion.section>
    </div>
  );
}
