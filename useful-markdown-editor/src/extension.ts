import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'updateMarkdown'; markdown: string }
  | { type: 'saveImage'; requestId: string; mimeType: string; dataBase64: string };

type ExtensionMessage =
  | { type: 'loadMarkdown'; markdown: string; documentDirUri: string | null }
  | { type: 'imageSaved'; requestId: string; markdown: string }
  | { type: 'imageSaveError'; requestId: string; error: string };

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'useful-markdown-editor.editor',
      new UsefulMarkdownEditorProvider(context),
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    )
  );
}

class UsefulMarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly context: vscode.ExtensionContext;

  public constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    const suppressedDocumentVersions = new Set<number>();
    let pendingEchoMarkdown: string | null = null;
    let editQueue: Promise<void> = Promise.resolve();

    const webviewRoot = vscode.Uri.joinPath(
      this.context.extensionUri,
      '..',
      'webview',
      'dist'
    );

    const documentDirUri = getDocumentDirWebviewUri(document, webviewPanel.webview);
    const localResourceRoots = [webviewRoot];
    if (document.uri.scheme === 'file') {
      localResourceRoots.push(vscode.Uri.file(path.dirname(document.uri.fsPath)));
    }

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots,
    };

    webviewPanel.webview.html = this.getWebviewHtml(webviewPanel.webview, webviewRoot);

    webviewPanel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        if (message.type === 'ready') {
          const initialMessage: ExtensionMessage = {
            type: 'loadMarkdown',
            markdown: document.getText(),
            documentDirUri,
          };
          webviewPanel.webview.postMessage(initialMessage);
          return;
        }

        if (message.type === 'updateMarkdown') {
          editQueue = editQueue.then(async () => {
            const nextMarkdown = message.markdown;
            const normalizedNextMarkdown = normalizeNewlines(nextMarkdown);
            const currentMarkdown = document.getText();
            const normalizedCurrentMarkdown = normalizeNewlines(currentMarkdown);
            if (normalizedNextMarkdown === normalizedCurrentMarkdown) {
              return;
            }

            const fullRange = new vscode.Range(
              document.positionAt(0),
              document.positionAt(currentMarkdown.length)
            );

            const expectedVersion = document.version + 1;
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, fullRange, nextMarkdown);
            const applied = await vscode.workspace.applyEdit(edit);
            if (applied) {
              suppressedDocumentVersions.add(expectedVersion);
              pendingEchoMarkdown = normalizedNextMarkdown;
            }
          }).catch((err: unknown) => {
            console.error('Failed to apply webview markdown update:', err);
          });
          await editQueue;
          return;
        }

        if (message.type === 'saveImage') {
          try {
            const imageMarkdown = await savePastedImageAndBuildMarkdown(
              document,
              message.mimeType,
              message.dataBase64
            );

            const savedMessage: ExtensionMessage = {
              type: 'imageSaved',
              requestId: message.requestId,
              markdown: imageMarkdown,
            };
            webviewPanel.webview.postMessage(savedMessage);
          } catch (err: unknown) {
            const errorMessage: ExtensionMessage = {
              type: 'imageSaveError',
              requestId: message.requestId,
              error: err instanceof Error ? err.message : 'Failed to save pasted image',
            };
            webviewPanel.webview.postMessage(errorMessage);
          }
        }
      },
      undefined,
      this.context.subscriptions
    );

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(function onDidChange(event) {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }

      const normalizedCurrentMarkdown = normalizeNewlines(document.getText());
      if (pendingEchoMarkdown !== null && normalizedCurrentMarkdown === pendingEchoMarkdown) {
        pendingEchoMarkdown = null;
        return;
      }

      if (suppressedDocumentVersions.has(event.document.version)) {
        suppressedDocumentVersions.delete(event.document.version);
        return;
      }

      const updateMessage: ExtensionMessage = {
        type: 'loadMarkdown',
        markdown: document.getText(),
        documentDirUri,
      };
      webviewPanel.webview.postMessage(updateMessage);
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });
  }

  private getWebviewHtml(webview: vscode.Webview, distRoot: vscode.Uri): string {
    const indexHtmlUri = vscode.Uri.joinPath(distRoot, 'index.html');
    let html = fs.readFileSync(indexHtmlUri.fsPath, 'utf8');

    const nonce = getNonce();

    html = html.replace(
      /<link rel="stylesheet" crossorigin href="(.+?)">/g,
      (_, assetPath: string) => {
        const assetUri = webview.asWebviewUri(vscode.Uri.joinPath(distRoot, assetPath));
        return `<link rel="stylesheet" href="${assetUri.toString()}">`;
      }
    );

    html = html.replace(
      /<script type="module" crossorigin src="(.+?)"><\/script>/g,
      (_, assetPath: string) => {
        const assetUri = webview.asWebviewUri(vscode.Uri.joinPath(distRoot, assetPath));
        return `<script nonce="${nonce}" type="module" src="${assetUri.toString()}"></script>`;
      }
    );

    html = html.replace(
      '</head>',
      `
      <meta
        http-equiv="Content-Security-Policy"
        content="
          default-src 'none';
          img-src ${webview.cspSource} https: data:;
          style-src ${webview.cspSource} 'unsafe-inline';
          font-src ${webview.cspSource};
          script-src 'nonce-${nonce}';
        "
      />
      </head>
      `
    );

    return html;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

async function savePastedImageAndBuildMarkdown(
  document: vscode.TextDocument,
  mimeType: string,
  dataBase64: string
): Promise<string> {
  if (document.uri.scheme !== 'file') {
    throw new Error('Image paste requires a saved file on disk.');
  }

  const documentDir = path.dirname(document.uri.fsPath);
  const assetsDir = path.join(documentDir, 'assets');
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(assetsDir));

  const extension = getImageExtension(mimeType);
  const fileName = `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const imagePath = path.join(assetsDir, fileName);
  const imageBytes = Buffer.from(dataBase64, 'base64');

  await vscode.workspace.fs.writeFile(vscode.Uri.file(imagePath), new Uint8Array(imageBytes));

  const relativePath = path.posix.join('assets', fileName);
  return `![](${relativePath})`;
}

function getImageExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') {
    return 'jpg';
  }
  if (normalized === 'image/gif') {
    return 'gif';
  }
  if (normalized === 'image/webp') {
    return 'webp';
  }
  if (normalized === 'image/svg+xml') {
    return 'svg';
  }
  return 'png';
}

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n/g, '\n');
}

function getDocumentDirWebviewUri(
  document: vscode.TextDocument,
  webview: vscode.Webview
): string | null {
  if (document.uri.scheme !== 'file') {
    return null;
  }

  const documentDir = vscode.Uri.file(path.dirname(document.uri.fsPath));
  return webview.asWebviewUri(documentDir).toString();
}
