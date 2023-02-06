/// <reference path="./types.d.ts" />
import * as vscode from "vscode";
import { Disposable, disposeAll } from "./dispose";
import { getNonce } from "./util";
import { width, height } from "./client/peak-analyzer";
import { posix } from "path";

interface SoundEdit {
  readonly channel: ReadonlyArray<number>;
}

interface SoundDocumentDelegate {
  getFileData(): Promise<Uint8Array>;
}

class SoundDocument extends Disposable implements vscode.CustomDocument {
  static async create(
    uri: vscode.Uri,
    backupId: string | undefined,
    delegate: SoundDocumentDelegate
  ): Promise<SoundDocument | PromiseLike<SoundDocument>> {
    const dataFile =
      typeof backupId === "string" ? vscode.Uri.parse(backupId) : uri;
    const fileData = await SoundDocument.readFile(dataFile);
    return new SoundDocument(uri, fileData, delegate);
  }

  private static async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    if (uri.scheme === "untitled") {
      return new Uint8Array();
    }
    return new Uint8Array(await vscode.workspace.fs.readFile(uri));
  }

  private readonly _uri: vscode.Uri;

  private _documentData: Uint8Array;
  private _edits: Array<SoundEdit> = [];
  private _savedEdits: Array<SoundEdit> = [];

  private readonly _delegate: SoundDocumentDelegate;

  private constructor(
    uri: vscode.Uri,
    initialContent: Uint8Array,
    delegate: SoundDocumentDelegate
  ) {
    super();
    this._uri = uri;
    this._documentData = initialContent;
    this._delegate = delegate;
  }

  public get uri() {
    return this._uri;
  }

  public get documentData(): Uint8Array {
    return this._documentData;
  }

  private readonly _onDidDispose = this._register(
    new vscode.EventEmitter<void>()
  );
  public readonly onDidDispose = this._onDidDispose.event;

  private readonly _onDidChangeDocument = this._register(
    new vscode.EventEmitter<{
      readonly content?: Uint8Array;
      readonly edits: readonly SoundEdit[];
    }>()
  );
  public readonly onDidChangeContent = this._onDidChangeDocument.event;

  private readonly _onDidChange = this._register(
    new vscode.EventEmitter<{
      readonly label: string;
      undo(): void;
      redo(): void;
    }>()
  );

  public readonly onDidChange = this._onDidChange.event;

  dispose(): void {
    this._onDidDispose.fire();
    super.dispose();
  }

  makeEdit(edit: SoundEdit) {
    this._edits.push(edit);

    this._onDidChange.fire({
      label: "Audio",
      undo: async () => {
        this._edits.pop();
        this._onDidChangeDocument.fire({
          edits: this._edits,
        });
      },
      redo: async () => {
        this._edits.push(edit);
        this._onDidChangeDocument.fire({
          edits: this._edits,
        });
      },
    });
  }

  async save(cancellation: vscode.CancellationToken): Promise<void> {
    await this.saveAs(this.uri, cancellation);
    this._savedEdits = Array.from(this._edits);
  }

  async saveAs(
    targetResource: vscode.Uri,
    cancellation: vscode.CancellationToken
  ): Promise<void> {
    const fileData = await this._delegate.getFileData();
    if (cancellation.isCancellationRequested) {
      return;
    }
    await vscode.workspace.fs.writeFile(targetResource, fileData);
  }

  async revert(_cancellation: vscode.CancellationToken): Promise<void> {
    const diskContent = await SoundDocument.readFile(this.uri);
    this._documentData = diskContent;
    this._edits = this._savedEdits;
    this._onDidChangeDocument.fire({
      content: diskContent,
      edits: this._edits,
    });
  }

  async backup(
    destination: vscode.Uri,
    cancellation: vscode.CancellationToken
  ): Promise<vscode.CustomDocumentBackup> {
    await this.saveAs(destination, cancellation);

    return {
      id: destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(destination);
        } catch {
          // noop
        }
      },
    };
  }
}

export class SoundEditorProvider
  implements vscode.CustomEditorProvider<SoundDocument>
{
  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      SoundEditorProvider.viewType,
      new SoundEditorProvider(context),
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  private static readonly viewType = "SoundEditor.CoreSoundEditor";

  /**
   * Tracks all known webviews
   */
  private readonly webviews = new WebviewCollection();

  constructor(private readonly _context: vscode.ExtensionContext) {}

  //#region CustomEditorProvider

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: { backupId?: string },
    _token: vscode.CancellationToken
  ): Promise<SoundDocument> {
    const document: SoundDocument = await SoundDocument.create(
      uri,
      openContext.backupId,
      {
        getFileData: async () => {
          const webviewsForDocument = Array.from(
            this.webviews.get(document.uri)
          );
          if (!webviewsForDocument.length) {
            throw new Error("Could not find webview to save for");
          }
          const panel = webviewsForDocument[0];
          const response = await this.postMessageWithResponse<number[]>(
            panel,
            "getFileData",
            {}
          );
          return new Uint8Array(response);
        },
      }
    );

    const listeners: vscode.Disposable[] = [];

    listeners.push(
      document.onDidChange((e) => {
        this._onDidChangeCustomDocument.fire({
          document,
          ...e,
        });
      })
    );

    listeners.push(
      document.onDidChangeContent((e) => {
        for (const webviewPanel of this.webviews.get(document.uri)) {
          this.postMessage(webviewPanel, "update", {
            edits: e.edits,
            content: e.content,
          });
        }
      })
    );

    document.onDidDispose(() => disposeAll(listeners));

    return document;
  }

  async resolveCustomEditor(
    document: SoundDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.webviews.add(document.uri, webviewPanel);

    webviewPanel.webview.options = {
      enableScripts: true,
    };
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    webviewPanel.webview.onDidReceiveMessage((e) =>
      this.onMessage(document, e)
    );

    webviewPanel.webview.onDidReceiveMessage((e) => {
      if (e.type === "ready") {
        if (document.uri.scheme === "untitled") {
          this.postMessage(webviewPanel, "init", {
            untitled: true,
            editable: true,
            path: posix.extname(document.uri.fsPath),
          });
        } else {
          const editable = vscode.workspace.fs.isWritableFileSystem(
            document.uri.scheme
          );

          this.postMessage(webviewPanel, "init", {
            value: document.documentData,
            path: posix.extname(document.uri.fsPath),
            editable,
          });
        }
      }
    });
  }

  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<SoundDocument>
  >();
  public readonly onDidChangeCustomDocument =
    this._onDidChangeCustomDocument.event;

  public saveCustomDocument(
    document: SoundDocument,
    cancellation: vscode.CancellationToken
  ): Thenable<void> {
    return document.save(cancellation);
  }

  public saveCustomDocumentAs(
    document: SoundDocument,
    destination: vscode.Uri,
    cancellation: vscode.CancellationToken
  ): Thenable<void> {
    return document.saveAs(destination, cancellation);
  }

  public revertCustomDocument(
    document: SoundDocument,
    cancellation: vscode.CancellationToken
  ): Thenable<void> {
    return document.revert(cancellation);
  }

  public backupCustomDocument(
    document: SoundDocument,
    context: vscode.CustomDocumentBackupContext,
    cancellation: vscode.CancellationToken
  ): Thenable<vscode.CustomDocumentBackup> {
    return document.backup(context.destination, cancellation);
  }

  //#endregion

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptMainUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "dist",
        "client",
        "client.js"
      )
    );
    const lameUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "dist", "lame.min.js")
    );
    const styleMainUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "style", "index.css")
    );
    const muteUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "assets",
        "icon--mute.svg"
      )
    );
    const robotUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "assets",
        "icon--robot.svg"
      )
    );
    const reverseUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "assets",
        "icon--reverse.svg"
      )
    );
    const louderUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "assets",
        "icon--louder.svg"
      )
    );
    const softerUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "assets",
        "icon--softer.svg"
      )
    );
    const fadeInUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "assets",
        "icon--fade-in.svg"
      )
    );
    const fadeOutUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "assets",
        "icon--fade-out.svg"
      )
    );
    const copyUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "assets",
        "icon--copy.svg"
      )
    );
    const pasteUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "assets",
        "icon--paste.svg"
      )
    );
    const playUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "assets",
        "icon--play.svg"
      )
    );
    const stopUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "assets",
        "icon--stop.svg"
      )
    );
    const trimUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "assets",
        "icon--trim.svg"
      )
    );
    const deleteUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "assets",
        "icon--delete.svg"
      )
    );
    const fasterUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "assets",
        "icon--faster.svg"
      )
    );
    const slowerUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "assets",
        "icon--slower.svg"
      )
    );
    const echoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "assets",
        "icon--echo.svg"
      )
    );
    const nonce = getNonce();

    return /* html */ `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<!--
				Use a content security policy to only allow loading images from https or from our extension directory,
				and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${
          webview.cspSource
        } blob:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${styleMainUri}" rel="stylesheet" />
				<script id="metadata" type="application/json">
				    {
						"play": "${playUri}",
						"stop": "${stopUri}"
					}
				</script>
				<title>Sound Editor</title>
			</head>
			<body>
				<div class="container">
				    <span class="top-zone">
					     <svg id="draw-canvas" viewBox="0 0 ${width * (750 / 600)} ${height}">
                   <g transform="scale(1.25, -1) translate(0, -${height / 2})">
                        <path
                           d="M 0 0"
                           id="draw-path"
                           strokeLinejoin="round"
                           strokeWidth="1"
                        />
                   </g>
               </svg>
						 </span>
					     <span id="control-top-zone">
                   <span id="play-head"></span>
                   <span id="trimmer">
                       <span id="left-handle"></span>
                       <span id="right-handle"></span>
                   </span>
						   </span>
					</span>
				    <span class="button-zone">
					<span class="play-button">
					     <img src="${playUri}" />
					</span>
					<span class="effect-button-container">
					<span class="effect-button-container-main">
            <span class="effect-button" id="copy-button">
                   <img src="${copyUri}" />
                   <p>copy</p>
            </span>
            <span class="effect-button" id="paste-button">
                   <img src="${pasteUri}" />
                   <p>paste</p>
            </span>
            <span class="effect-button" id="delete-button">
                   <img src="${deleteUri}" />
                   <p>delete</p>
            </span>
					     <span class="effect-button" id="fade-in-effect">
						        <img src="${fadeInUri}" />
								<p>fade in</p>
			             </span>
						 <span class="effect-button" id="fade-out-effect">
						        <img src="${fadeOutUri}" />
								<p>fade out</p>
			             </span>
						 <span class="effect-button" id="louder-effect">
							    <img src="${louderUri}" />
								<p>louder</p>
						 </span>
						 <span class="effect-button" id="softer-effect">
							    <img src="${softerUri}" />
								<p>softer</p>
						 </span>
						 <span class="effect-button" id="faster-effect">
							    <img src="${fasterUri}" />
								<p>faster</p>
						 </span>
						 <span class="effect-button" id="slower-effect">
							    <img src="${slowerUri}" />
								<p>slower</p>
						 </span>
						 <span class="effect-button" id="robot-effect">
							    <img src="${robotUri}" />
								<p>robot</p>
						 </span>
						 <span class="effect-button" id="mute-effect">
							    <img src="${muteUri}" />
								<p>mute</p>
						 </span>
             <span class="effect-button" id="echo-effect">
							    <img src="${echoUri}" />
								<p>echo</p>
						 </span>
             <span class="effect-button" id="reverse-effect">
							    <img src="${reverseUri}" />
								<p>reverse</p>
						 </span>
				    </span>
					</span>
					</span>
				</div>
        <script src="${lameUri}" nonce="${nonce}"></script>
				<script src="${scriptMainUri}" nonce="${nonce}" ></script>
			</body>
			</html>`;
  }

  private _requestId = 1;
  private readonly _callbacks = new Map<number, (response: any) => void>();

  private postMessageWithResponse<R = unknown>(
    panel: vscode.WebviewPanel,
    type: string,
    body: any
  ): Promise<R> {
    const requestId = this._requestId++;
    const p = new Promise<R>((resolve) =>
      this._callbacks.set(requestId, resolve)
    );
    panel.webview.postMessage({ type, requestId, body });
    return p;
  }

  private postMessage(
    panel: vscode.WebviewPanel,
    type: string,
    body: any
  ): void {
    panel.webview.postMessage({ type, body });
  }

  private onMessage(document: SoundDocument, message: any) {
    switch (message.type) {
      case "audio":
        document.makeEdit(message as SoundEdit);
        return;

      case "response": {
        const callback = this._callbacks.get(message.requestId);
        callback?.(message.body);
        return;
      }
    }
  }
}

class WebviewCollection {
  private readonly _webviews = new Set<{
    readonly resource: string;
    readonly webviewPanel: vscode.WebviewPanel;
  }>();

  public *get(uri: vscode.Uri): Iterable<vscode.WebviewPanel> {
    const key = uri.toString();
    for (const entry of this._webviews) {
      if (entry.resource === key) {
        yield entry.webviewPanel;
      }
    }
  }

  public add(uri: vscode.Uri, webviewPanel: vscode.WebviewPanel) {
    const entry = { resource: uri.toString(), webviewPanel };
    this._webviews.add(entry);

    webviewPanel.onDidDispose(() => {
      this._webviews.delete(entry);
    });
  }
}
