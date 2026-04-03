[![NPM version][npm-version-image]][npm-url] [![NPM downloads][npm-downloads-image]][npm-url] [![build][build-image]][build-url] [![MIT License][license-image]][license-url] 

# dicomweb-multipart-parser

A fast streaming multipart parser for DICOMweb STOW-RS payloads in Node.js.

dicomweb-multipart-parser is focused on multipart/related requests where each part is expected to be a DICOM instance. It is built for stream-first processing so you can parse large uploads without buffering entire requests in memory. This library was inspired by the [dicer][dicer-url] and [busboy][busboy-url] multipart parsers.

## Install

```bash
npm install dicomweb-multipart-parser
```

## Quick Example

```js
const http = require('http');
const DicomwebMultipartParser = require('dicomweb-multipart-parser');

http
	.createServer((req, res) => {
		if (req.method !== 'POST' || req.url !== '/studies') {
			res.writeHead(404);
			res.end();
			return;
		}

		let dicomwebMultipartParser;
		try {
			dicomwebMultipartParser = new DicomwebMultipartParser({
				headers: req.headers,
				ignorePartsWithoutDicomPreamble: false,
			});
		} catch (err) {
			res.writeHead(400);
			res.end(err.message);
			return;
		}

		dicomwebMultipartParser.on('part', (part) => {
			// new part has arrived

			part.on('header', (header) => {
				// header values are arrays
				// e.g. header['content-type'] => ['application/dicom']
			});

			part.on('data', (chunk) => {
				// stream each DICOM part chunk to storage, processing, etc.
			});

			part.on('error', (err) => {
				// invalid part headers or optional preamble validation failures
				console.error('Part error:', err.message);
			});

			part.on('end', () => {
				// part completed
			});
		});

		dicomwebMultipartParser.on('error', (err) => {
			res.writeHead(400);
			res.end(err.message);
		});

		dicomwebMultipartParser.on('finish', () => {
			res.writeHead(200);
			res.end();
		});

		req.pipe(dicomwebMultipartParser);
	})
	.listen(8080);
```

## API

dicomweb-multipart-parser is a Writable stream.

### Constructor

```js
const dicomwebMultipartParser = new DicomwebMultipartParser(options);
```

Options:

- headers (required): request headers object containing content-type
- partHighWaterMark (optional, number): highWaterMark used when creating each part stream
- maxHeaderPairs (optional, number): max number of header key/value pairs parsed per part (default 2000)
- ignorePartsWithoutDicomPreamble (optional, boolean, default false):
	- when false: parts are not preamble-validated
	- when true: part body is checked for a DICOM preamble (128-byte preamble + DICM marker) and invalid parts are ignored with a part error event

Constructor validation:

- top-level content-type must be multipart/related
- boundary parameter must be present
- if content-type type parameter is present, it must be application/dicom

### DicomwebMultipartParser Events

- part(stream): emitted when a new part is found
- finish(): emitted when multipart parsing completes
- error(err): emitted for parser-level errors

### DicomwebMultipartParser Methods

- reset(): resets parser internals so the instance can be reused

### PartStream Events

Each part is a Readable stream.

- header(headerObject): emitted once part headers are parsed
	- header keys are lowercase
	- each header value is an array of strings
- data(chunk): emitted for body chunks
- end(): emitted when the part is complete
- error(err): emitted for invalid part conditions, including:
	- missing part Content-Type header
	- unexpected part Content-Type (must be application/dicom)
	- invalid DICOM preamble when ignorePartsWithoutDicomPreamble is true

## License

dicomweb-multipart-parser is released under the MIT License.

[npm-url]: https://npmjs.org/package/dicomweb-multipart-parser
[npm-version-image]: https://img.shields.io/npm/v/dicomweb-multipart-parser.svg?style=flat
[npm-downloads-image]: http://img.shields.io/npm/dm/dicomweb-multipart-parser.svg?style=flat

[build-url]: https://github.com/PantelisGeorgiadis/dicomweb-multipart-parser/actions/workflows/build.yml
[build-image]: https://github.com/PantelisGeorgiadis/dicomweb-multipart-parser/actions/workflows/build.yml/badge.svg?branch=master

[license-image]: https://img.shields.io/badge/license-MIT-blue.svg?style=flat
[license-url]: LICENSE.txt

[dicer-url]: https://github.com/mscdex/dicer
[busboy-url]: https://github.com/mscdex/busboy
