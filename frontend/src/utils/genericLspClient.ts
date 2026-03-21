import type * as Monaco from "monaco-editor";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

type LspPosition = {
  line: number;
  character: number;
};

type LspRange = {
  start: LspPosition;
  end: LspPosition;
};

type LspDiagnostic = {
  range: LspRange;
  severity?: number;
  message: string;
  source?: string;
  code?: string | number;
};

type LspTextEdit = {
  newText: string;
  range?: LspRange;
  insert?: LspRange;
  replace?: LspRange;
};

type LspCompletionItem = {
  label: string | { label: string };
  kind?: number;
  detail?: string;
  documentation?: unknown;
  insertText?: string;
  insertTextFormat?: number;
  sortText?: string;
  filterText?: string;
  textEdit?: LspTextEdit;
};

type LspHover = {
  contents?: unknown;
  range?: LspRange;
};

type LspRuntimeState = {
  connected: boolean;
  detail: string | null;
};

interface GenericLspClientOptions {
  monaco: typeof Monaco;
  sessionId: string;
  rootPath: string;
  languageId: string;
  languageLabel: string;
  onStateChange: (state: LspRuntimeState) => void;
  onDiagnosticsChanged?: () => void;
}

function getWsBaseUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

function toFileUri(monaco: typeof Monaco, filePath: string) {
  return monaco.Uri.file(filePath).toString();
}

function toMonacoRange(monaco: typeof Monaco, range: LspRange) {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );
}

function fromMarkdownContent(contents: unknown): Monaco.IMarkdownString[] {
  if (!contents) return [];
  if (Array.isArray(contents)) {
    return contents.flatMap(fromMarkdownContent);
  }
  if (typeof contents === "string") {
    return [{ value: contents }];
  }
  if (typeof contents === "object" && contents !== null && "value" in contents) {
    return [{ value: String((contents as { value: unknown }).value ?? "") }];
  }
  return [];
}

function toCompletionDocumentation(contents: unknown): string | Monaco.IMarkdownString | undefined {
  const values = fromMarkdownContent(contents);
  if (values.length === 0) return undefined;
  if (values.length === 1) return values[0];
  return {
    value: values.map((item) => item.value).join("\n\n"),
  };
}

function toCompletionLabel(label: LspCompletionItem["label"]) {
  return typeof label === "string" ? label : label.label;
}

function completionKindToMonaco(monaco: typeof Monaco, kind?: number) {
  switch (kind) {
    case 2:
      return monaco.languages.CompletionItemKind.Method;
    case 3:
      return monaco.languages.CompletionItemKind.Function;
    case 4:
      return monaco.languages.CompletionItemKind.Constructor;
    case 5:
      return monaco.languages.CompletionItemKind.Field;
    case 6:
      return monaco.languages.CompletionItemKind.Variable;
    case 7:
      return monaco.languages.CompletionItemKind.Class;
    case 8:
      return monaco.languages.CompletionItemKind.Interface;
    case 9:
      return monaco.languages.CompletionItemKind.Module;
    case 10:
      return monaco.languages.CompletionItemKind.Property;
    case 11:
      return monaco.languages.CompletionItemKind.Unit;
    case 12:
      return monaco.languages.CompletionItemKind.Value;
    case 13:
      return monaco.languages.CompletionItemKind.Enum;
    case 14:
      return monaco.languages.CompletionItemKind.Keyword;
    case 15:
      return monaco.languages.CompletionItemKind.Snippet;
    case 16:
      return monaco.languages.CompletionItemKind.Color;
    case 17:
      return monaco.languages.CompletionItemKind.File;
    case 18:
      return monaco.languages.CompletionItemKind.Reference;
    case 19:
      return monaco.languages.CompletionItemKind.Folder;
    case 21:
      return monaco.languages.CompletionItemKind.Constant;
    case 22:
      return monaco.languages.CompletionItemKind.Struct;
    case 23:
      return monaco.languages.CompletionItemKind.Event;
    case 24:
      return monaco.languages.CompletionItemKind.Operator;
    case 25:
      return monaco.languages.CompletionItemKind.TypeParameter;
    default:
      return monaco.languages.CompletionItemKind.Text;
  }
}

function diagnosticSeverityToMonaco(monaco: typeof Monaco, severity?: number) {
  switch (severity) {
    case 1:
      return monaco.MarkerSeverity.Error;
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    case 4:
      return monaco.MarkerSeverity.Hint;
    default:
      return monaco.MarkerSeverity.Info;
  }
}

function getDefaultCompletionRange(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
) {
  const word = model.getWordUntilPosition(position);
  return new monaco.Range(
    position.lineNumber,
    word.startColumn,
    position.lineNumber,
    word.endColumn,
  );
}

function toCompletionRange(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  textEdit?: LspTextEdit,
) {
  const fallback = getDefaultCompletionRange(monaco, model, position);
  if (!textEdit) {
    return fallback;
  }
  if (textEdit.insert && textEdit.replace) {
    return {
      insert: toMonacoRange(monaco, textEdit.insert),
      replace: toMonacoRange(monaco, textEdit.replace),
    };
  }
  if (textEdit.range) {
    return toMonacoRange(monaco, textEdit.range);
  }
  return fallback;
}

export class GenericLspClient {
  private readonly markerOwner: string;
  private ws: WebSocket | null = null;
  private connected = false;
  private initialized = false;
  private connectPromise: Promise<void> | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private documentVersions = new Map<string, number>();
  private changeTimers = new Map<string, number>();
  private completionDisposable: Monaco.IDisposable | null = null;
  private hoverDisposable: Monaco.IDisposable | null = null;

  constructor(private readonly options: GenericLspClientOptions) {
    this.markerOwner = `remote-code-lsp-${options.languageId}`;
  }

  ensureProviders() {
    if (!this.completionDisposable) {
      this.completionDisposable = this.options.monaco.languages.registerCompletionItemProvider(this.options.languageId, {
        triggerCharacters: [".", ":", "\"", "'", "/", "@", "<"],
        provideCompletionItems: async (model, position) => {
          await this.openDocument(model);
          const response = await this.sendRequest("textDocument/completion", {
            textDocument: { uri: model.uri.toString() },
            position: { line: position.lineNumber - 1, character: position.column - 1 },
          }).catch(() => null);

          const completionList = response as { items?: LspCompletionItem[]; isIncomplete?: boolean } | LspCompletionItem[] | null;
          const rawItems = Array.isArray(completionList)
            ? completionList
            : Array.isArray(completionList?.items)
              ? completionList.items
              : [];

          return {
            incomplete: !Array.isArray(completionList) && Boolean(completionList?.isIncomplete),
            suggestions: rawItems.map((item) => {
              const label = toCompletionLabel(item.label);
              const textEdit = item.textEdit;
              return {
                label,
                kind: completionKindToMonaco(this.options.monaco, item.kind),
                detail: item.detail,
                documentation: toCompletionDocumentation(item.documentation),
                insertText: textEdit?.newText ?? item.insertText ?? label,
                insertTextRules: item.insertTextFormat === 2
                  ? this.options.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                  : undefined,
                filterText: item.filterText,
                sortText: item.sortText,
                range: toCompletionRange(this.options.monaco, model, position, textEdit),
              };
            }),
          };
        },
      });
    }

    if (!this.hoverDisposable) {
      this.hoverDisposable = this.options.monaco.languages.registerHoverProvider(this.options.languageId, {
        provideHover: async (model, position) => {
          await this.openDocument(model);
          const response = await this.sendRequest("textDocument/hover", {
            textDocument: { uri: model.uri.toString() },
            position: { line: position.lineNumber - 1, character: position.column - 1 },
          }).catch(() => null);

          const hover = response as LspHover | null;
          if (!hover?.contents) {
            return null;
          }

          return {
            contents: fromMarkdownContent(hover.contents),
            range: hover.range ? toMonacoRange(this.options.monaco, hover.range) : undefined,
          };
        },
      });
    }
  }

  async openDocument(model: Monaco.editor.ITextModel) {
    if (model.getLanguageId() !== this.options.languageId) {
      return;
    }

    await this.ensureConnected();
    const uri = model.uri.toString();
    const nextVersion = model.getVersionId();
    const previousVersion = this.documentVersions.get(uri);

    if (previousVersion == null) {
      this.documentVersions.set(uri, nextVersion);
      this.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: this.options.languageId,
          version: nextVersion,
          text: model.getValue(),
        },
      });
      return;
    }

    if (previousVersion === nextVersion) {
      return;
    }

    this.documentVersions.set(uri, nextVersion);
    this.sendNotification("textDocument/didChange", {
      textDocument: {
        uri,
        version: nextVersion,
      },
      contentChanges: [{ text: model.getValue() }],
    });
  }

  queueDocumentSync(model: Monaco.editor.ITextModel) {
    if (model.getLanguageId() !== this.options.languageId) {
      return;
    }

    const key = model.uri.toString();
    const previousTimer = this.changeTimers.get(key);
    if (previousTimer) {
      window.clearTimeout(previousTimer);
    }

    const timer = window.setTimeout(() => {
      void this.openDocument(model);
      this.changeTimers.delete(key);
    }, 150);

    this.changeTimers.set(key, timer);
  }

  notifySaved(model: Monaco.editor.ITextModel) {
    if (model.getLanguageId() !== this.options.languageId) {
      return;
    }

    this.sendNotification("textDocument/didSave", {
      textDocument: {
        uri: model.uri.toString(),
      },
    });
  }

  closeDocument(model: Monaco.editor.ITextModel | null) {
    if (!model || model.getLanguageId() !== this.options.languageId) {
      return;
    }

    const uri = model.uri.toString();
    const timer = this.changeTimers.get(uri);
    if (timer) {
      window.clearTimeout(timer);
      this.changeTimers.delete(uri);
    }

    if (!this.documentVersions.has(uri)) {
      return;
    }

    this.documentVersions.delete(uri);
    this.sendNotification("textDocument/didClose", {
      textDocument: { uri },
    });
    this.options.monaco.editor.setModelMarkers(model, this.markerOwner, []);
    this.options.onDiagnosticsChanged?.();
  }

  async ensureConnected() {
    if (this.initialized) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    const { languageId, languageLabel, monaco, onStateChange, rootPath, sessionId } = this.options;
    const ws = new WebSocket(`${getWsBaseUrl()}/ws/ide/${sessionId}/lsp/${languageId}`);
    this.ws = ws;
    onStateChange({ connected: false, detail: `Connecting ${languageLabel} language server...` });

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false;

      const fail = (detail: string, reason?: unknown) => {
        onStateChange({ connected: false, detail });
        if (!settled) {
          settled = true;
          this.connectPromise = null;
          reject(reason instanceof Error ? reason : new Error(detail));
        }
      };

      ws.onopen = async () => {
        this.connected = true;
        try {
          const rootUri = toFileUri(monaco, rootPath);
          await this.dispatchRequest("initialize", {
            processId: null,
            clientInfo: { name: "Remote Code", version: "1.0.0" },
            rootUri,
            capabilities: {
              textDocument: {
                completion: {
                  completionItem: {
                    documentationFormat: ["markdown", "plaintext"],
                    snippetSupport: true,
                  },
                },
                hover: {
                  contentFormat: ["markdown", "plaintext"],
                },
              },
              workspace: {
                workspaceFolders: true,
                configuration: true,
              },
            },
            workspaceFolders: [{ uri: rootUri, name: rootPath.split(/[\\/]/).pop() || "workspace" }],
          });
          this.sendNotification("initialized", {});
          this.initialized = true;
          onStateChange({ connected: true, detail: `${languageLabel} LSP ready` });
          if (!settled) {
            settled = true;
            resolve();
          }
        } catch (error) {
          fail(`${languageLabel} LSP initialization failed`, error);
          try {
            ws.close();
          } catch {
            // Ignore close failures after an initialization error.
          }
        }
      };

      ws.onmessage = (event) => {
        const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
        this.handleMessage(payload);
      };

      ws.onerror = () => {
        if (!this.initialized) {
          onStateChange({ connected: false, detail: `${languageLabel} LSP connection failed` });
        }
      };

      ws.onclose = () => {
        this.connected = false;
        this.initialized = false;
        this.connectPromise = null;
        this.pending.forEach(({ reject: rejectPending }) => rejectPending(new Error(`${languageLabel} LSP disconnected`)));
        this.pending.clear();

        if (!settled) {
          settled = true;
          reject(new Error(`${languageLabel} LSP unavailable`));
        }

        onStateChange({ connected: false, detail: `${languageLabel} LSP unavailable` });
      };
    });

    return this.connectPromise;
  }

  dispose() {
    this.completionDisposable?.dispose();
    this.hoverDisposable?.dispose();
    this.completionDisposable = null;
    this.hoverDisposable = null;
    this.documentVersions.clear();
    this.changeTimers.forEach((timer) => window.clearTimeout(timer));
    this.changeTimers.clear();
    this.pending.forEach(({ reject }) => reject(new Error("Disposed")));
    this.pending.clear();
    this.ws?.close();
    this.ws = null;
  }

  private handleMessage(message: Record<string, unknown>) {
    if (typeof message.id === "number" || typeof message.id === "string") {
      if ("method" in message) {
        const id = message.id;
        const method = String(message.method);

        if (method === "workspace/workspaceFolders") {
          this.sendResponse(id, [{
            uri: toFileUri(this.options.monaco, this.options.rootPath),
            name: this.options.rootPath.split(/[\\/]/).pop() || "workspace",
          }]);
          return;
        }

        if (method === "workspace/configuration") {
          const items = Array.isArray((message.params as { items?: unknown[] } | undefined)?.items)
            ? ((message.params as { items: unknown[] }).items)
            : [];
          this.sendResponse(id, items.map(() => null));
          return;
        }

        if (
          method === "window/workDoneProgress/create"
          || method === "client/registerCapability"
          || method === "client/unregisterCapability"
        ) {
          this.sendResponse(id, null);
          return;
        }

        if (method === "workspace/applyEdit") {
          this.sendResponse(id, { applied: false });
          return;
        }

        if (method === "window/showDocument") {
          this.sendResponse(id, { success: false });
          return;
        }

        this.sendResponse(id, null);
        return;
      }

      const pending = this.pending.get(Number(message.id));
      if (!pending) {
        return;
      }

      this.pending.delete(Number(message.id));
      if ("error" in message) {
        pending.reject((message as { error?: { message?: string } }).error?.message ?? "LSP request failed");
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method === "textDocument/publishDiagnostics") {
      const params = message.params as { uri?: string; diagnostics?: LspDiagnostic[] } | undefined;
      const uri = params?.uri;
      if (!uri) {
        return;
      }

      const model = this.options.monaco.editor.getModel(this.options.monaco.Uri.parse(uri));
      if (!model) {
        return;
      }

      const diagnostics = params?.diagnostics ?? [];
      this.options.monaco.editor.setModelMarkers(model, this.markerOwner, diagnostics.map((diagnostic) => ({
        startLineNumber: diagnostic.range.start.line + 1,
        startColumn: diagnostic.range.start.character + 1,
        endLineNumber: diagnostic.range.end.line + 1,
        endColumn: diagnostic.range.end.character + 1,
        message: diagnostic.message,
        severity: diagnosticSeverityToMonaco(this.options.monaco, diagnostic.severity),
        source: diagnostic.source,
        code: diagnostic.code != null ? String(diagnostic.code) : undefined,
      })));
      this.options.onDiagnosticsChanged?.();
    }
  }

  private sendResponse(id: number | string, result: unknown) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  private async sendRequest(method: string, params: unknown) {
    await this.ensureConnected();
    return this.dispatchRequest(method, params);
  }

  private dispatchRequest(method: string, params: unknown) {
    const id = ++this.requestId;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws?.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  private sendNotification(method: string, params: unknown) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }
}
