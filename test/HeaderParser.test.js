const HeaderParser = require('./../src/HeaderParser');

const chai = require('chai');
const expect = chai.expect;

const DCRLF = '\r\n\r\n';
const MAXED_BUFFER = Buffer.allocUnsafe(128 * 1024);
MAXED_BUFFER.fill(0x41); // 'A'

describe('HeaderParser', () => {
  it('should correctly perform header parsing', () => {
    const cases = [
      { source: DCRLF, expected: {}, what: 'No header' },
      {
        source: ['Content-Type:\t  application/dicom', 'Content-Length:0'].join('\r\n') + DCRLF,
        expected: {
          'content-type': ['  application/dicom'],
          'content-length': ['0'],
        },
        what: 'Value spacing',
      },
      {
        source:
          ['Content-Type:\r\n application/dicom', 'Foo:\r\n bar\r\n baz'].join('\r\n') + DCRLF,
        expected: {
          'content-type': [' application/dicom'],
          foo: [' bar baz'],
        },
        what: 'Folded values',
      },
      {
        source: ['Content-Type:', 'Foo: '].join('\r\n') + DCRLF,
        expected: {
          'content-type': [''],
          foo: [''],
        },
        what: 'Empty values',
      },
      {
        source: MAXED_BUFFER.toString('ascii') + DCRLF,
        expected: {},
        what: 'Max header size (single chunk)',
      },
      {
        source: ['ABCDEFGHIJ', MAXED_BUFFER.toString('ascii'), DCRLF],
        expected: {},
        what: 'Max header size (multiple chunks #1)',
      },
      {
        source: [MAXED_BUFFER.toString('ascii'), MAXED_BUFFER.toString('ascii'), DCRLF],
        expected: {},
        what: 'Max header size (multiple chunk #2)',
      },
    ];

    for (const v of cases) {
      const parser = new HeaderParser();
      let fired = false;

      parser.on('header', (header) => {
        expect(fired, `${v.what}: Header event fired more than once`).to.equal(false);
        fired = true;
        expect(header, `${v.what}: Parsed result mismatch`).to.deep.equal(v.expected);
      });
      if (!Array.isArray(v.source)) {
        v.source = [v.source];
      }
      for (const chunk of v.source) {
        parser.push(chunk);
      }

      expect(fired, `${v.what}: Did not receive header from parser`).to.equal(true);
    }
  });

  it('should have case-insensitive header names', () => {
    const parser = new HeaderParser();
    let called = false;
    parser.on('header', (header) => {
      called = true;
      expect(header['content-type']).to.exist;
      expect(header['Content-Type']).to.not.exist;
    });
    parser.push('Content-Type: application/dicom\r\n\r\n');
    expect(called).to.equal(true);
  });

  it('should store multiple values for same header as an array', () => {
    const parser = new HeaderParser();
    let called = false;
    parser.on('header', (header) => {
      called = true;
      expect(header['x-custom']).to.deep.equal(['value1', 'value2', 'value3']);
    });
    parser.push('X-Custom: value1\r\nX-Custom: value2\r\nX-Custom: value3\r\n\r\n');
    expect(called).to.equal(true);
  });

  it('should respect maxHeaderPairs configuration', () => {
    const parser = new HeaderParser({ maxHeaderPairs: 2 });
    let called = false;
    parser.on('header', (header) => {
      called = true;
      // Only first 2 headers should be parsed
      expect(Object.keys(header)).to.have.length(2);
      expect(header['a']).to.exist;
      expect(header['b']).to.exist;
      expect(header['c']).to.not.exist;
    });
    parser.push('A: 1\r\nB: 2\r\nC: 3\r\n\r\n');
    expect(called).to.equal(true);
  });

  it('should clear state on reset for reuse', () => {
    const parser = new HeaderParser();
    let callCount = 0;
    parser.on('header', (header) => {
      callCount++;
    });

    // First parse
    parser.push('X-First: yes\r\n\r\n');
    expect(callCount).to.equal(1);
    expect(parser._finished).to.equal(true);

    // Reset and second parse
    parser.reset();
    expect(parser._finished).to.equal(false);
    parser.push('X-Second: yes\r\n\r\n');
    expect(callCount).to.equal(2);
  });

  it('should handle data split across chunk boundaries', () => {
    const parser = new HeaderParser();
    let called = false;
    parser.on('header', (header) => {
      called = true;
      expect(header['content-type']).to.deep.equal(['text/plain']);
    });
    // Split the header across multiple chunks
    parser.push('Conten');
    parser.push('t-Type: te');
    parser.push('xt/plain\r\n');
    parser.push('\r\n');
    expect(called).to.equal(true);
  });

  it('should emit error on unexpected folded header', () => {
    const parser = new HeaderParser();
    let errorEmitted = false;
    let headerEmitted = false;

    parser.on('error', (err) => {
      errorEmitted = true;
      expect(err.message).to.include('Unexpected folded');
    });
    parser.on('header', () => {
      headerEmitted = true;
    });

    // Folded header without a preceding header
    parser.push(' folded value\r\n\r\n');
    expect(errorEmitted).to.equal(true);
    expect(headerEmitted).to.equal(false);
  });

  it('should allow header with no space after colon', () => {
    const parser = new HeaderParser();
    let called = false;
    parser.on('header', (header) => {
      called = true;
      expect(header['x-value']).to.deep.equal(['noSpace']);
    });
    parser.push('X-Value:noSpace\r\n\r\n');
    expect(called).to.equal(true);
  });

  it('should set finished flag after parsing', () => {
    const parser = new HeaderParser();
    expect(parser._finished).to.equal(false);
    parser.on('header', () => {
      expect(parser._finished).to.equal(true);
    });
    parser.push('X: 1\r\n\r\n');
    expect(parser._finished).to.equal(true);
  });

  it('should emit empty header when maxHeaderPairs is zero', () => {
    const parser = new HeaderParser({ maxHeaderPairs: 0 });
    let called = false;

    parser.on('header', (header) => {
      called = true;
      expect(header).to.deep.equal({});
    });

    parser.push('X-Test: 1\r\n\r\n');
    expect(called).to.equal(true);
  });
});
