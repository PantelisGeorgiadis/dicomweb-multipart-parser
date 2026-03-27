const DicomDicer = require('./../src/DicomDicer');

const chai = require('chai');
const expect = chai.expect;

function buildDicomBuffer(withPreamble) {
  const payload = Buffer.from('payload-data');

  if (!withPreamble) {
    // Keep this buffer >= 132 bytes so DICOM preamble validation executes.
    const invalidPrefix = Buffer.alloc(132, 0);
    invalidPrefix.write('NOPE', 128, 'ascii');
    return Buffer.concat([invalidPrefix, payload]);
  }

  const preamble = Buffer.alloc(128, 0);
  return Buffer.concat([preamble, Buffer.from('DICM'), payload]);
}

function buildMultipartBody(boundary, parts) {
  const chunks = [];

  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));

    const headerLines = Object.entries(part.headers).map(([k, v]) => `${k}: ${v}`);
    chunks.push(Buffer.from(`${headerLines.join('\r\n')}\r\n\r\n`));

    chunks.push(part.body);
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--`));

  return Buffer.concat(chunks);
}

function writeInChunks(stream, buffer, chunkSize) {
  return new Promise((resolve, reject) => {
    let offset = 0;

    function writeNext() {
      while (offset < buffer.length) {
        const end = Math.min(offset + chunkSize, buffer.length);
        const chunk = buffer.slice(offset, end);
        offset = end;

        const shouldContinue = stream.write(chunk);
        if (!shouldContinue) {
          stream.once('drain', writeNext);
          return;
        }
      }

      stream.end();
    }

    stream.once('error', reject);
    stream.once('finish', resolve);

    writeNext();
  });
}

describe('DicomDicer', () => {
  function createParser() {
    return new DicomDicer({
      headers: {
        'content-type': 'multipart/related; type=application/dicom; boundary=internal-test',
      },
    });
  }

  it('should parse a full Content-Type header line and lowercase tokens', () => {
    const dicer = createParser();
    const parsed = dicer._parseContentType(
      'Content-Type: MULTIPART/RELATED; BOUNDARY="abc"; TYPE="application/dicom"\r\n'
    );

    expect(parsed).to.deep.equal({
      type: 'multipart',
      subtype: 'related',
      params: {
        boundary: 'abc',
        type: 'application/dicom',
      },
    });
  });

  it('should return undefined for empty parsed header value', () => {
    const dicer = createParser();
    expect(dicer._parseContentType('Content-Type:   \r\n')).to.equal(undefined);
  });

  it('should return undefined for malformed type and subtype forms', () => {
    const dicer = createParser();

    expect(dicer._parseContentType('/related')).to.equal(undefined);
    expect(dicer._parseContentType('multipart')).to.equal(undefined);
    expect(dicer._parseContentType('multipart/')).to.equal(undefined);
    expect(dicer._parseContentType('multipart/; boundary=x')).to.equal(undefined);
  });

  it('should return undefined for malformed parameter separators and values', () => {
    const dicer = createParser();

    expect(dicer._parseContentType('multipart/related boundary=x')).to.equal(undefined);
    expect(dicer._parseContentType('multipart/related;   ')).to.equal(undefined);
    expect(dicer._parseContentType('multipart/related; p?=1')).to.equal(undefined);
    expect(dicer._parseContentType('multipart/related; charset')).to.equal(undefined);
    expect(dicer._parseContentType('multipart/related; charset=')).to.equal(undefined);
    expect(dicer._parseContentType('multipart/related; charset=; boundary=x')).to.equal(undefined);
  });

  it('should parse escaped quoted parameter values', () => {
    const dicer = createParser();
    const parsed = dicer._parseContentType(
      'multipart/related; boundary="ab\\\\cd\\\"ef"; type="application/dicom"'
    );

    expect(parsed).to.deep.equal({
      type: 'multipart',
      subtype: 'related',
      params: {
        boundary: 'ab\\cd"ef',
        type: 'application/dicom',
      },
    });
  });

  it('should return undefined for unterminated quoted parameter values', () => {
    const dicer = createParser();
    expect(dicer._parseContentType('multipart/related; boundary="abc')).to.equal(undefined);
  });

  it('should allow trailing whitespace after parameters', () => {
    const dicer = createParser();
    const parsed = dicer._parseContentType(
      'multipart/related; boundary=test-boundary; type=application/dicom   \r\n\t'
    );

    expect(parsed).to.deep.equal({
      type: 'multipart',
      subtype: 'related',
      params: {
        boundary: 'test-boundary',
        type: 'application/dicom',
      },
    });
  });

  it('should throw when headers are missing', () => {
    expect(() => new DicomDicer()).to.throw('Headers are required');
  });

  it('should throw when content-type header is missing', () => {
    expect(() => new DicomDicer({ headers: {} })).to.throw('Content-Type header is required');
  });

  it('should throw when content-type is not multipart/related', () => {
    expect(() => new DicomDicer({ headers: { 'content-type': 'application/dicom' } })).to.throw(
      'Content-Type must be multipart/related'
    );
  });

  it('should throw when boundary parameter is missing', () => {
    expect(
      () =>
        new DicomDicer({
          headers: {
            'content-type': 'multipart/related; type=application/dicom',
          },
        })
    ).to.throw('Boundary parameter is required in Content-Type header');
  });

  it('should throw when type parameter is not application/dicom', () => {
    expect(
      () =>
        new DicomDicer({
          headers: {
            'content-type': 'multipart/related; type=text/plain; boundary=abc',
          },
        })
    ).to.throw('Content-Type parameter "type" must be application/dicom');
  });

  it('should emit header and full payload for a valid DICOM part', async () => {
    const boundary = 'test-boundary-1';
    const dicer = new DicomDicer({
      headers: {
        'content-type': `multipart/related; type=application/dicom; boundary=${boundary}`,
      },
    });

    const body = buildDicomBuffer(true);
    const multipart = buildMultipartBody(boundary, [
      {
        headers: { 'content-type': 'application/dicom' },
        body,
      },
    ]);

    let partCount = 0;
    let gotHeader = false;
    const dataChunks = [];

    dicer.on('part', (part) => {
      partCount += 1;

      part.on('header', (header) => {
        gotHeader = true;
        expect(header['content-type']).to.deep.equal(['application/dicom']);
      });

      part.on('data', (chunk) => {
        dataChunks.push(chunk);
      });
    });

    await writeInChunks(dicer, multipart, 17);

    expect(partCount).to.equal(1);
    expect(gotHeader).to.equal(true);
    expect(Buffer.concat(dataChunks)).to.deep.equal(body);
  });

  it('should emit part error for missing part content-type header', async () => {
    const boundary = 'test-boundary-2';
    const dicer = new DicomDicer({
      headers: {
        'content-type': `multipart/related; type=application/dicom; boundary=${boundary}`,
      },
    });

    const multipart = buildMultipartBody(boundary, [
      {
        headers: { 'x-custom': '1' },
        body: buildDicomBuffer(true),
      },
    ]);

    const partErrors = [];

    dicer.on('part', (part) => {
      part.on('error', (err) => partErrors.push(err.message));
    });

    await writeInChunks(dicer, multipart, 32);

    expect(partErrors).to.deep.equal(['Missing Content-Type header in part. Ignoring part...']);
  });

  it('should emit part error for unexpected part content-type', async () => {
    const boundary = 'test-boundary-3';
    const dicer = new DicomDicer({
      headers: {
        'content-type': `multipart/related; type=application/dicom; boundary=${boundary}`,
      },
    });

    const multipart = buildMultipartBody(boundary, [
      {
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{"a":1}'),
      },
    ]);

    const partErrors = [];

    dicer.on('part', (part) => {
      part.on('error', (err) => partErrors.push(err.message));
    });

    await writeInChunks(dicer, multipart, 64);

    expect(partErrors).to.deep.equal([
      'Unexpected part Content-Type: application/json. Ignoring part...',
    ]);
  });

  it('should ignore invalid preamble when ignorePartsWithoutDicomPreamble is true', async () => {
    const boundary = 'test-boundary-4';
    const dicer = new DicomDicer({
      headers: {
        'content-type': `multipart/related; type=application/dicom; boundary=${boundary}`,
      },
      ignorePartsWithoutDicomPreamble: true,
    });

    const multipart = buildMultipartBody(boundary, [
      {
        headers: { 'content-type': 'application/dicom' },
        body: buildDicomBuffer(false),
      },
    ]);

    const partErrors = [];
    let dataBytes = 0;

    dicer.on('part', (part) => {
      part.on('error', (err) => partErrors.push(err.message));
      part.on('data', (chunk) => {
        dataBytes += chunk.length;
      });
    });

    await writeInChunks(dicer, multipart, 9);

    expect(partErrors).to.deep.equal([
      'Part does not have a valid DICOM preamble. Ignoring part...',
    ]);
    expect(dataBytes).to.equal(0);
  });

  it('should pass through valid preamble when ignorePartsWithoutDicomPreamble is true', async () => {
    const boundary = 'test-boundary-5';
    const dicer = new DicomDicer({
      headers: {
        'content-type': `multipart/related; type=application/dicom; boundary=${boundary}`,
      },
      ignorePartsWithoutDicomPreamble: true,
    });

    const body = buildDicomBuffer(true);
    const multipart = buildMultipartBody(boundary, [
      {
        headers: { 'content-type': 'application/dicom' },
        body,
      },
    ]);

    const chunks = [];

    dicer.on('part', (part) => {
      part.on('data', (chunk) => chunks.push(chunk));
    });

    await writeInChunks(dicer, multipart, 5);

    expect(Buffer.concat(chunks)).to.deep.equal(body);
  });
});
