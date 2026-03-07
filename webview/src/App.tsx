import { useCallback, useEffect, useRef, useState } from 'react';
import { Editor, defaultValueCtx, rootCtx } from '@milkdown/core';
import { gfm } from '@milkdown/preset-gfm';
import { commonmark } from '@milkdown/preset-commonmark';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { nord } from '@milkdown/theme-nord';
import { replaceAll } from '@milkdown/utils';
import '@milkdown/theme-nord/style.css';
import './App.css';

type ExtensionToWebviewMessage =
  | { type: 'loadMarkdown'; markdown: string };

type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'updateMarkdown'; markdown: string };

type VsCodeApi = {
  postMessage: (message: WebviewToExtensionMessage) => void;
};

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

export default function App() {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const editorRef = useRef<Editor | null>(null);
  const applyingExternalUpdateRef = useRef<boolean>(false);
  const latestEditorMarkdownRef = useRef<string>('');
  const pendingIncomingMarkdownRef = useRef<string | null>(null);
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

  useEffect(function setupVsCodeBridge() {
    const vscode = window.acquireVsCodeApi?.() ?? null;
    vscodeRef.current = vscode;

    function handleMessage(event: MessageEvent<ExtensionToWebviewMessage>) {
      const message = event.data;
      if (!message) return;

      if (message.type === 'loadMarkdown') {
        applyIncomingMarkdown(message.markdown);
      }
    }

    window.addEventListener('message', handleMessage);
    vscodeRef.current?.postMessage({ type: 'ready' });

    return function cleanup() {
      window.removeEventListener('message', handleMessage);
    };
  }, [applyIncomingMarkdown]);

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
      <section className="app-editor">
        <div ref={editorHostRef} className="editor-host" />
        {loading ? <div className="editor-loading">Loading editor...</div> : null}
        {error ? <div className="editor-error">{error}</div> : null}
      </section>
    </main>
  );
}
