import { useCallback, useEffect, useRef, useState } from 'react';
import { Editor, defaultValueCtx, rootCtx } from '@milkdown/core';
import { gfm } from '@milkdown/preset-gfm';
import { commonmark } from '@milkdown/preset-commonmark';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { nord } from '@milkdown/theme-nord';
import { insert, replaceAll } from '@milkdown/utils';
import '@milkdown/theme-nord/style.css';
import './App.css';

type ExtensionToWebviewMessage =
  | { type: 'loadMarkdown'; markdown: string; documentDirUri: string | null }
  | { type: 'imageSaved'; requestId: string; markdown: string }
  | { type: 'imageSaveError'; requestId: string; error: string };

type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'updateMarkdown'; markdown: string }
  | { type: 'saveImage'; requestId: string; mimeType: string; dataBase64: string };

type VsCodeApi = {
  postMessage: (message: WebviewToExtensionMessage) => void;
};

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

type ToolbarAction = {
  id: string;
  label: string;
  snippet: string;
  title: string;
};

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  { id: 'h1', label: 'H1', snippet: '\n# Heading\n', title: 'Insert heading' },
  { id: 'bold', label: 'B', snippet: '**bold text**', title: 'Insert bold text' },
  { id: 'italic', label: 'I', snippet: '*italic text*', title: 'Insert italic text' },
  { id: 'link', label: 'Link', snippet: '[link text](https://example.com)', title: 'Insert link' },
  { id: 'code', label: 'Code', snippet: '\n```\ncode\n```\n', title: 'Insert code block' },
  { id: 'quote', label: 'Quote', snippet: '\n> quote\n', title: 'Insert block quote' },
  { id: 'list', label: 'List', snippet: '\n- item 1\n- item 2\n', title: 'Insert list' },
];

export default function App() {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const editorRef = useRef<Editor | null>(null);
  const applyingExternalUpdateRef = useRef<boolean>(false);
  const latestEditorMarkdownRef = useRef<string>('');
  const pendingIncomingMarkdownRef = useRef<string | null>(null);
  const pendingImageRequestsRef = useRef<Set<string>>(new Set());
  const documentDirUriRef = useRef<string | null>(null);
  const vscodeRef = useRef<VsCodeApi | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);

  const applyIncomingMarkdown = useCallback((nextMarkdown: string) => {
    const editor = editorRef.current;
    if (!editor) {
      pendingIncomingMarkdownRef.current = nextMarkdown;
      return;
    }

    if (nextMarkdown === latestEditorMarkdownRef.current) {
      return;
    }

    applyingExternalUpdateRef.current = true;
    try {
      editor.action(replaceAll(nextMarkdown, true));
      latestEditorMarkdownRef.current = nextMarkdown;
      setError('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to apply document update');
    } finally {
      queueMicrotask(() => {
        applyingExternalUpdateRef.current = false;
      });
    }
  }, []);

  const insertMarkdownAtCursor = useCallback((snippet: string) => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    try {
      editor.action(insert(snippet));
      setError('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to insert markdown');
    }
  }, []);

  const arrayBufferToBase64 = useCallback((buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
      binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
  }, []);

  useEffect(function setupVsCodeBridge() {
    const vscode = window.acquireVsCodeApi?.() ?? null;
    vscodeRef.current = vscode;

    function handleMessage(event: MessageEvent<ExtensionToWebviewMessage>) {
      const message = event.data;
      if (!message) return;

      if (message.type === 'loadMarkdown') {
        documentDirUriRef.current = message.documentDirUri;
        applyIncomingMarkdown(message.markdown);
        return;
      }

      if (message.type === 'imageSaved') {
        if (!pendingImageRequestsRef.current.has(message.requestId)) {
          return;
        }

        pendingImageRequestsRef.current.delete(message.requestId);
        insertMarkdownAtCursor(`${message.markdown}\n`);
        return;
      }

      if (message.type === 'imageSaveError') {
        if (!pendingImageRequestsRef.current.has(message.requestId)) {
          return;
        }

        pendingImageRequestsRef.current.delete(message.requestId);
        setError(message.error);
      }
    }

    window.addEventListener('message', handleMessage);
    vscodeRef.current?.postMessage({ type: 'ready' });

    return function cleanup() {
      window.removeEventListener('message', handleMessage);
    };
  }, [applyIncomingMarkdown, insertMarkdownAtCursor]);

  useEffect(function resolveRenderedImageSources() {
    const host = editorHostRef.current;
    if (!host) {
      return;
    }

    const rewriteImageSource = (img: HTMLImageElement) => {
      const rawSrc = img.getAttribute('src');
      if (!rawSrc) {
        return;
      }

      if (
        rawSrc.startsWith('http://')
        || rawSrc.startsWith('https://')
        || rawSrc.startsWith('data:')
        || rawSrc.startsWith('blob:')
        || rawSrc.startsWith('vscode-webview://')
      ) {
        return;
      }

      const baseUri = documentDirUriRef.current;
      if (!baseUri) {
        return;
      }

      const normalizedRaw = rawSrc.replace(/^\.?\//, '');
      const normalizedBase = baseUri.endsWith('/') ? baseUri.slice(0, -1) : baseUri;
      img.src = `${normalizedBase}/${normalizedRaw}`;
    };

    const rewriteAll = () => {
      host.querySelectorAll('img').forEach((node) => {
        if (node instanceof HTMLImageElement) {
          rewriteImageSource(node);
        }
      });
    };

    rewriteAll();

    const observer = new MutationObserver(() => {
      rewriteAll();
    });

    observer.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(function setupPasteImageHandler() {
    async function onPaste(event: ClipboardEvent) {
      const host = editorHostRef.current;
      if (!host) {
        return;
      }

      const activeElement = document.activeElement;
      if (!(activeElement instanceof HTMLElement) || !host.contains(activeElement)) {
        return;
      }

      const items = event.clipboardData?.items;
      if (!items || items.length === 0) {
        return;
      }

      const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'));
      if (!imageItem) {
        return;
      }

      const imageFile = imageItem.getAsFile();
      if (!imageFile) {
        return;
      }

      event.preventDefault();

      const requestId = `paste-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      pendingImageRequestsRef.current.add(requestId);

      try {
        const dataBase64 = arrayBufferToBase64(await imageFile.arrayBuffer());
        vscodeRef.current?.postMessage({
          type: 'saveImage',
          requestId,
          mimeType: imageFile.type || 'image/png',
          dataBase64,
        });
      } catch (err: unknown) {
        pendingImageRequestsRef.current.delete(requestId);
        setError(err instanceof Error ? err.message : 'Failed to process pasted image');
      }
    }

    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('paste', onPaste);
    };
  }, [arrayBufferToBase64]);

  useEffect(function mountMilkdownEditor() {
    const host = editorHostRef.current;
    if (!host) {
      return;
    }

    let disposed = false;

    Editor.make()
      .config(nord)
      .use(listener)
      .config((ctx) => {
        ctx.set(rootCtx, host);
        ctx.set(defaultValueCtx, '');
        ctx.get(listenerCtx).markdownUpdated((_ctx, nextMarkdown) => {
          if (applyingExternalUpdateRef.current) {
            return;
          }

          latestEditorMarkdownRef.current = nextMarkdown;
          vscodeRef.current?.postMessage({ type: 'updateMarkdown', markdown: nextMarkdown });
        });
      })
      .use(commonmark)
      .use(gfm)
      .create()
      .then((instance) => {
        if (disposed) {
          void instance.destroy();
          return;
        }

        editorRef.current = instance;
        const pendingMarkdown = pendingIncomingMarkdownRef.current;
        if (pendingMarkdown !== null) {
          pendingIncomingMarkdownRef.current = null;
          applyIncomingMarkdown(pendingMarkdown);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (disposed) {
          return;
        }

        setError(err instanceof Error ? err.message : 'Failed to create editor');
        setLoading(false);
      });

    return function cleanup() {
      disposed = true;
      const editor = editorRef.current;
      editorRef.current = null;
      if (editor) {
        void editor.destroy();
      }
    };
  }, [applyIncomingMarkdown]);

  return (
    <main className="app">
      <header className="toolbar">
        {TOOLBAR_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            className="toolbar-button"
            title={action.title}
            onClick={() => insertMarkdownAtCursor(action.snippet)}
          >
            {action.label}
          </button>
        ))}
      </header>
      <section className="app-editor">
        <div ref={editorHostRef} className="editor-host" />
        {loading ? <div className="editor-loading">Loading editor...</div> : null}
        {error ? <div className="editor-error">{error}</div> : null}
      </section>
    </main>
  );
}
