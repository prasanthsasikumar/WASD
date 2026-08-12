/* Shared by the simulator and the create page: a generated app travels as
   gzip in a URL parameter, so both ends need the same codec. The browser's
   own CompressionStream keeps the site dependency-free. base64url rather
   than base64 because the payload lives in a query string. */
(function () {
  'use strict';

  function toBase64Url(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function compress(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return toBase64Url(await new Response(stream).arrayBuffer());
  }

  async function decompress(param) {
    const stream = new Blob([fromBase64Url(param)]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  window.WASDCodec = { compress: compress, decompress: decompress };
})();
