# Vendored dependencies

## qrcode.min.js

[qrcodejs](https://github.com/davidshimjs/qrcodejs) v1.0.0 by David Shim, MIT licensed.

Vendored rather than loaded from a CDN so the QR feature works offline, adds no
third-party request to every page view, and cannot break when someone else's
CDN path moves. Unmodified.

`wasd.js` uses `new QRCode(el, { text, width, height, colorDark, colorLight,
correctLevel })` and `QRCode.CorrectLevel.L`.
