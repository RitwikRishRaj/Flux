import type * as monacoNS from "monaco-editor";

// Flux editor theme — same ink/ground as the rest of the app.
export const FLUX_THEME: monacoNS.editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "E1E0CC", background: "0B0B0A" },
    { token: "comment", foreground: "6E6C5F" },
    { token: "string", foreground: "5FD0A8" },
    { token: "keyword", foreground: "E58FB4" },
    { token: "number", foreground: "F0A27F" },
    { token: "type", foreground: "7FB2F0" },
    { token: "identifier", foreground: "E1E0CC" },
  ],
  colors: {
    "editor.background": "#0B0B0A",
    "editor.foreground": "#E1E0CC",
    "editor.lineHighlightBackground": "#E1E0CC0A",
    "editorLineNumber.foreground": "#E1E0CC30",
    "editorLineNumber.activeForeground": "#E1E0CC80",
    "editorCursor.foreground": "#E1E0CC",
    "editor.selectionBackground": "#E1E0CC22",
    "editorIndentGuide.background1": "#E1E0CC12",
    "editorWidget.background": "#121210",
    "editorWidget.border": "#E1E0CC1A",
    "scrollbarSlider.background": "#E1E0CC1F",
    "scrollbarSlider.hoverBackground": "#E1E0CC33",
  },
};
