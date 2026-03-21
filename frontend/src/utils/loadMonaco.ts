import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

type MonacoModule = typeof import("monaco-editor");

let configured = false;

function ensureWorkerEnvironment() {
  const globalScope = self as typeof self & {
    MonacoEnvironment?: {
      getWorker: (_workerId: string, label: string) => Worker;
    };
  };

  if (globalScope.MonacoEnvironment) {
    return;
  }

  globalScope.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case "json":
          return new jsonWorker();
        case "css":
        case "scss":
        case "less":
          return new cssWorker();
        case "html":
        case "handlebars":
        case "razor":
          return new htmlWorker();
        case "typescript":
        case "javascript":
          return new tsWorker();
        default:
          return new editorWorker();
      }
    },
  };
}

function configureMonaco(monaco: MonacoModule) {
  monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
  monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);

  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    allowJs: true,
    allowNonTsExtensions: true,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    noEmit: true,
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
  });

  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    allowJs: true,
    allowNonTsExtensions: true,
    checkJs: true,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    noEmit: true,
    target: monaco.languages.typescript.ScriptTarget.ES2020,
  });

  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: true,
    trailingCommas: "ignore",
  });

  monaco.languages.html.htmlDefaults.setOptions({
    format: {
      tabSize: 2,
      insertSpaces: true,
      wrapLineLength: 120,
      contentUnformatted: "pre,code,textarea",
      indentInnerHtml: false,
      preserveNewLines: true,
      maxPreserveNewLines: 2,
      endWithNewline: false,
      extraLiners: "head, body, /html",
      indentHandlebars: false,
      wrapAttributes: "auto",
      unformatted: "code,pre,em,strong,span",
    },
    suggest: {
      html5: true,
    },
  });

  monaco.languages.css.cssDefaults.setOptions({
    validate: true,
  });
}

export async function loadMonacoEditor() {
  ensureWorkerEnvironment();
  const monaco = await import("monaco-editor");
  if (!configured) {
    configureMonaco(monaco);
    configured = true;
  }
  return monaco;
}
