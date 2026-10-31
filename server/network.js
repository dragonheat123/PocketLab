import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';

export function isPublicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}

/** Resolve and pin public addresses, including after redirects, to prevent SSRF. */
export async function downloadDocument(input, redirects = 0) {
  const url = new URL(input);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port)) || redirects > 4) {
    throw new Error('Unsupported document URL');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('Document address is not public');
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      headers: { 'User-Agent': 'PocketLab/1.0 (academic research reader)', Accept: 'application/pdf,text/html,text/plain' },
      lookup: (_host, options, callback) => options?.all ? callback(null, [address]) : callback(null, address.address, address.family),
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        resolve(downloadDocument(new URL(response.headers.location, url).href, redirects + 1));
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Document returned HTTP ${response.statusCode}`)); return; }
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) request.destroy(new Error('Document exceeds 8 MB limit'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ buffer: Buffer.concat(chunks), type: response.headers['content-type'] || '', url: url.href }));
    });
    const deadline = setTimeout(() => request.destroy(new Error('Document download timed out')), 18000);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', reject);
  });
}

export async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(typeof data.error === 'string' ? data.error : 'Provider rejected request');
  return data;
}
