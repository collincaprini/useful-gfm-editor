# Useful Markdown Editor

Useful Markdown Editor is a custom VS Code editor for `.md` and `.markdown` files powered by Milkdown Crepe.

## Features

- Rich markdown editing experience with GFM support
- Tables, code blocks, toolbar, link tooltip, list item controls, and LaTeX
- Image paste support that saves files into `assets/` next to the current markdown file
- Real-time syncing with the underlying document

## Usage

1. Open a `.md` or `.markdown` file.
2. VS Code opens it with `Useful Markdown Editor` (custom editor).
3. Paste images directly from clipboard to save and insert markdown links.

## Development

From repository root:

```bash
npm run build
```

This builds both the webview app and extension bundle.

## Packaging

From `useful-markdown-editor/`:

```bash
npm run package:vsix
```

This will:

1. Build the webview bundle.
2. Bundle extension code.
3. Copy webview assets into the extension package.
4. Create a `.vsix` file.

## Publishing

1. Set `publisher` in `package.json` to your actual publisher ID.
2. Create a Personal Access Token with Marketplace manage scope.
3. Login once:

```bash
npx @vscode/vsce login <publisher-id>
```

4. Publish:

```bash
npm run publish:patch
```

You can also use `publish:minor` or `publish:major`.
