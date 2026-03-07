import { cp, access, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(scriptDir, '..');
const repoDir = path.resolve(extensionDir, '..');
const webviewDistDir = path.join(repoDir, 'webview', 'dist');
const extensionWebviewDistDir = path.join(extensionDir, 'dist', 'webview');

try {
  await access(webviewDistDir);
} catch {
  throw new Error(`Webview build output not found at: ${webviewDistDir}`);
}

await rm(extensionWebviewDistDir, { recursive: true, force: true });
await mkdir(extensionWebviewDistDir, { recursive: true });
await cp(webviewDistDir, extensionWebviewDistDir, { recursive: true });

console.log(`Copied webview dist to ${extensionWebviewDistDir}`);
