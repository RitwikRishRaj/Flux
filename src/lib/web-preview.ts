// A literal "</script" or "</style" in user code would close the tag early and spill the rest as HTML.
export const buildSrcDoc = (html: string, css: string, js: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${css.replace(/<\/style/gi, "<\\/style")}</style></head>` +
  `<body>${html}<script>${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
