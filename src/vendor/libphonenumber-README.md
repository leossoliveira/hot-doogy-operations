# Phone formatting

Vendored `libphonenumber-js` 1.13.15 (MIT), bundled from its `min` entry with esbuild. Source: https://github.com/catamphetamine/libphonenumber-js.

Exports: `AsYouType`, `parsePhoneNumberFromString`. The bundle includes country metadata and runs locally; phone numbers are not sent to an external service.

Rebuild with the pinned package and an entry exporting those two names, using `esbuild entry.js --bundle --format=esm --minify --outfile=src/vendor/libphonenumber.min.js`.
