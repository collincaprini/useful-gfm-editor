import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
	const provider = new MarkdownEditorProvider(context);

	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(
			MarkdownEditorProvider.viewType,
			provider,
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
			},
		),
	);
}

export function deactivate(): void {}

class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
	public static readonly viewType = 'useful-markdown-editor.editor';

	private readonly context: vscode.ExtensionContext;

	public constructor(context: vscode.ExtensionContext) {
		this.context = context;
	}

	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken,
	): Promise<void> {
		webviewPanel.webview.options = {
			enableScripts: true,
		};

		const testWebView = 

		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

		const updateWebview = void webviewPanel.webview.postMessage({
			type: 'setDocument',
			text: document.getText(),
			uri: document.uri.toString(),
		});

		await updateWebview;

		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
			if (event.document.uri.toString() !== document.uri.toString()) {
				return;
			}

			void webviewPanel.webview.postMessage({
				type: 'setDocument',
				text: document.getText(),
				uri: document.uri.toString(),
			});
		});

		webviewPanel.onDidDispose(() => {
			changeDocumentSubscription.dispose();
		});

		webviewPanel.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'ready': {
					await webviewPanel.webview.postMessage({
						type: 'setDocument',
						text: document.getText(),
						uri: document.uri.toString(),
					});
					return;
				}

				case 'updateDocument': {
					await this.updateTextDocument(document, message.text);
					return;
				}
			}
		});
	}

	private async updateTextDocument(
		document: vscode.TextDocument,
		newText: string,
	): Promise<void> {
		const edit = new vscode.WorkspaceEdit();

		edit.replace(
			document.uri,
			new vscode.Range(
				document.positionAt(0),
				document.positionAt(document.getText().length),
			),
			newText,
		);

		await vscode.workspace.applyEdit(edit);
	}

	private getHtmlForWebview(webview: vscode.Webview): string {
		const nonce = getNonce();

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta
		http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
	/>
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Useful Markdown Editor</title>
</head>
<body>
	<div id="root" style="padding: 16px; font-family: sans-serif;"></div>

5

		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
	}
}

function getNonce(): string {
	const chars =
		'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

	let value = '';
	for (let index = 0; index < 32; index += 1) {
		value += chars.charAt(Math.floor(Math.random() * chars.length));
	}

	return value;
}