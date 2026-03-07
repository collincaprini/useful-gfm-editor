import * as vscode from 'vscode';
import * as fs from 'node:fs';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'updateMarkdown'; markdown: string };

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
    let suppressedDocumentVersion = -1;

    const webviewRoot = vscode.Uri.joinPath(
      this.context.extensionUri,
      '..',
      'webview',
      'dist'
    );

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [webviewRoot],
    };

    webviewPanel.webview.html = this.getWebviewHtml(webviewPanel.webview, webviewRoot);

    webviewPanel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        if (message.type === 'ready') {
          webviewPanel.webview.postMessage({
            type: 'loadMarkdown',
            markdown: document.getText(),
          });
          return;
        }

        if (message.type === 'updateMarkdown') {
          const nextMarkdown = message.markdown;
          const currentMarkdown = document.getText();
          if (nextMarkdown === currentMarkdown) {
            return;
          }

          const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(currentMarkdown.length)
          );

          const currentVersion = document.version;
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, fullRange, nextMarkdown);
          const applied = await vscode.workspace.applyEdit(edit);
          if (applied) {
            suppressedDocumentVersion = currentVersion + 1;
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

      if (event.document.version === suppressedDocumentVersion) {
        suppressedDocumentVersion = -1;
        return;
      }

      webviewPanel.webview.postMessage({
        type: 'loadMarkdown',
        markdown: document.getText(),
      });
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
