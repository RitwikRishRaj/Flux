// postinstall: y-monaco imports "monaco-editor/esm/vs/editor/editor.api.js", which monaco-editor's package exports no
// longer expose, so the build fails with "Module not found". Point it at "monaco-editor". Node, not bash: runs everywhere npm does.
import fs from "node:fs";

for (const file of ["node_modules/y-monaco/src/y-monaco.js", "node_modules/y-monaco/dist/y-monaco.cjs"]) {
  if (!fs.existsSync(file)) continue;
  const code = fs.readFileSync(file, "utf8");
  const patched = code.replaceAll("monaco-editor/esm/vs/editor/editor.api.js", "monaco-editor");
  if (patched !== code) fs.writeFileSync(file, patched);
  console.log(`y-monaco: ${patched !== code ? "patched" : "already patched"} ${file}`);
}
