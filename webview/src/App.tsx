import { useCallback, useEffect, useRef, useState } from 'react';
import { Crepe, CrepeFeature } from '@milkdown/crepe';
import { insert, replaceAll } from '@milkdown/utils';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/nord-dark.css';
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

const CREPE_FEATURES: Partial<Record<CrepeFeature, boolean>> = {
  [CrepeFeature.CodeMirror]: true,
  [CrepeFeature.ListItem]: true,
  [CrepeFeature.LinkTooltip]: true,
  [CrepeFeature.Cursor]: true,
  [CrepeFeature.ImageBlock]: true,
  [CrepeFeature.BlockEdit]: true,
  [CrepeFeature.Toolbar]: true,
  [CrepeFeature.Placeholder]: true,
  [CrepeFeature.Table]: true,
  [CrepeFeature.Latex]: true,
};

export default function App() {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const crepeRef = useRef<Crepe | null>(null);
  const applyingExternalUpdateRef = useRef<boolean>(false);
  const latestEditorMarkdownRef = useRef<string>('');
  const pendingIncomingMarkdownRef = useRef<string | null>(null);
  const pendingImageRequestsRef = useRef<Set<string>>(new Set());
  const documentDirUriRef = useRef<string | null>(null);
  const vscodeRef = useRef<VsCodeApi | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const queuedSyncMarkdownRef = useRef<string | null>(null);
  const lastSyncedMarkdownRef = useRef<string>('');

  const flushMarkdownSync = useCallback(() => {
    const markdown = queuedSyncMarkdownRef.current;
    if (markdown === null) {
      return;
    }

    queuedSyncMarkdownRef.current = null;
    if (markdown === lastSyncedMarkdownRef.current) {
      return;
    }

    lastSyncedMarkdownRef.current = markdown;
    vscodeRef.current?.postMessage({ type: 'updateMarkdown', markdown });
  }, []);

  const scheduleMarkdownSync = useCallback((markdown: string) => {
    queuedSyncMarkdownRef.current = markdown;

    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current);
    }

    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null;
      flushMarkdownSync();
    }, 250);
  }, [flushMarkdownSync]);

  const applyIncomingMarkdown = useCallback((nextMarkdown: string) => {
    const crepe = crepeRef.current;
    if (!crepe) {
      pendingIncomingMarkdownRef.current = nextMarkdown;
      return;
    }

    if (nextMarkdown === latestEditorMarkdownRef.current) {
      return;
    }

    applyingExternalUpdateRef.current = true;
    try {
      crepe.editor.action(replaceAll(nextMarkdown, true));
      latestEditorMarkdownRef.current = nextMarkdown;
      lastSyncedMarkdownRef.current = nextMarkdown;
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
    const crepe = crepeRef.current;
    if (!crepe) {
      return;
    }

    try {
      crepe.editor.action(insert(snippet));
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

    const rewriteInNode = (node: Node) => {
      if (node instanceof HTMLImageElement) {
        rewriteImageSource(node);
        return;
      }

      if (node instanceof HTMLElement) {
        node.querySelectorAll('img').forEach((img) => {
          if (img instanceof HTMLImageElement) {
            rewriteImageSource(img);
          }
        });
      }
    };

    rewriteInNode(host);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          if (target instanceof HTMLImageElement) {
            rewriteImageSource(target);
          }
          return;
        }

        mutation.addedNodes.forEach((node) => {
          rewriteInNode(node);
        });
      });
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

  useEffect(function mountCrepeEditor() {
    const host = editorHostRef.current;
    if (!host) {
      return;
    }

    let disposed = false;

    const crepe = new Crepe({
      root: host,
      defaultValue: '',
      features: CREPE_FEATURES,
    });

    crepe.on((api) => {
      api.markdownUpdated((_ctx, nextMarkdown) => {
        if (applyingExternalUpdateRef.current) {
          return;
        }

        latestEditorMarkdownRef.current = nextMarkdown;
        scheduleMarkdownSync(nextMarkdown);
      });
    });

    crepe.create()
      .then(() => {
        if (disposed) {
          void crepe.destroy();
          return;
        }

        crepeRef.current = crepe;
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
      const currentCrepe = crepeRef.current;
      crepeRef.current = null;
      if (currentCrepe) {
        void currentCrepe.destroy();
      } else {
        void crepe.destroy();
      }
    };
  }, [applyIncomingMarkdown, scheduleMarkdownSync]);

  useEffect(() => {
    const flush = () => {
      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      flushMarkdownSync();
    };

    const onBlur = () => {
      flush();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    };

    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      flush();
    };
  }, [flushMarkdownSync]);

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
