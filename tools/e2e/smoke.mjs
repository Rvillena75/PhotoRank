import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const distDirectory = resolve(repositoryRoot, 'dist');

function command(commandName, argumentsList) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(commandName, argumentsList, { cwd: repositoryRoot, stdio: 'inherit' });
    child.once('error', rejectCommand);
    child.once('exit', (code) => code === 0
      ? resolveCommand()
      : rejectCommand(new Error(`${commandName} exited with code ${code}.`)));
  });
}

function contentType(pathname) {
  switch (extname(pathname)) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.wasm': return 'application/wasm';
    case '.onnx': return 'application/octet-stream';
    case '.png': return 'image/png';
    case '.jpg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//u, '');
      let filePath = resolve(distDirectory, relativePath);
      if (!filePath.startsWith(`${distDirectory}${sep}`)) throw new Error('Invalid path.');
      if ((await stat(filePath)).isDirectory()) filePath = resolve(filePath, 'index.html');
      response.writeHead(200, { 'Content-Type': contentType(filePath), 'Cache-Control': 'no-store' });
      response.end(await readFile(filePath));
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  return new Promise((resolveServer, rejectServer) => {
    server.once('error', rejectServer);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return rejectServer(new Error('Static server did not expose a port.'));
      resolveServer({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

await command('npx', ['expo', 'export', '--platform', 'web', '--clear']);
const { server, url } = await startServer();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const browserErrors = [];
page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
page.on('pageerror', (error) => browserErrors.push(error.message));
page.on('response', (response) => { if (response.status() >= 400) browserErrors.push(`${response.status()} ${response.url()}`); });

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Comenzar' }).click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Elegir fotos' }).click(),
  ]);
  await fileChooser.setFiles([
    'tools/model-export/fixtures/images/gradient_landscape.png',
    'tools/model-export/fixtures/images/checker_portrait.png',
    'tools/model-export/fixtures/images/exif_orientation_6.jpg',
    'tools/model-export/fixtures/images/radial_square.png',
    'tools/model-export/fixtures/images/stripes_wide.png',
    'tools/model-export/fixtures/images/solid_teal.png',
  ].map((path) => resolve(repositoryRoot, path)));
  await page.getByText('6 fotos seleccionadas').waitFor();
  await page.getByRole('button', { name: 'Empezar comparaciones' }).click();
  await page.getByRole('button', { name: 'Ver Top K provisional' }).click();
  await page.getByRole('button', { name: 'Crear carrusel' }).click();
  await Promise.race([
    page.getByText('Análisis local completado para 6 fotos.').waitFor({ timeout: 120_000 }),
    page.getByRole('button', { name: 'Reintentar análisis' }).waitFor({ timeout: 120_000 }).then(() => {
      throw new Error('Visual analysis entered its recoverable error state.');
    }),
  ]);
  await page.getByRole('progressbar').waitFor();
  await page.getByText('6 de 6 fotos · 100%').waitFor();
  if (browserErrors.length > 0) throw new Error(`Browser console errors: ${browserErrors.join(' | ')}`);
  console.log('Web smoke passed: Top K remained functional and six local ONNX embeddings completed.');
} catch (error) {
  console.error(`Browser console errors: ${browserErrors.join(' | ') || 'none captured'}`);
  console.error(`Rendered page: ${(await page.locator('body').innerText()).slice(0, 2000)}`);
  throw error;
} finally {
  await browser.close();
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
}
