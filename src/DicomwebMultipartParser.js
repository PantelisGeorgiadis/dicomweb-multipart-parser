const { Writable } = require('stream');

const HeaderParser = require('./HeaderParser');
const PartStream = require('./PartStream');
const StreamSearch = require('./StreamSearch');

// prettier-ignore
const TOKEN = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];
Object.freeze(TOKEN);

// prettier-ignore
const QDTEXT = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
];
Object.freeze(QDTEXT);

const DASH = 45;
const DICOM_PREAMBLE_LENGTH = 128;
const DICOM_PREFIX_LENGTH = DICOM_PREAMBLE_LENGTH + 4;
const B_DICM = Buffer.from('DICM');
const B_ONEDASH = Buffer.from('-');
const B_CRLF = Buffer.from('\r\n');
const EMPTY_FN = () => {};

//#region DicomwebMultipartParser
class DicomwebMultipartParser extends Writable {
  /**
   * Creates an instance of DicomwebMultipartParser.
   * @constructor
   * @param {Object} opts - Configuration options.
   * @param {Object} opts.headers - HTTP headers.
   * @param {number} [opts.ignorePartsWithoutDicomPreamble] - Flag to ignore parts without DICOM preamble.
   * @param {number} [opts.partHighWaterMark] - High water mark for part streams.
   * @throws {Error} If headers are not provided and Content-Type header is missing or is invalid.
   */
  constructor(opts) {
    super(opts);

    if (!opts || typeof opts.headers !== 'object') {
      throw new Error('Headers are required');
    }
    if (!opts.headers['content-type']) {
      throw new Error('Content-Type header is required');
    }
    const contentType = this._parseContentType(opts.headers['content-type']);
    if (!contentType || contentType.type !== 'multipart' || contentType.subtype !== 'related') {
      throw new Error('Content-Type must be multipart/related');
    }
    if (contentType.params && contentType.params.type) {
      const type = contentType.params.type.trim().toLowerCase();
      if (type !== 'application/dicom') {
        throw new Error('Content-Type parameter "type" must be application/dicom');
      }
    }
    if (!contentType.params || !contentType.params.boundary) {
      throw new Error('Boundary parameter is required in Content-Type header');
    }
    this._ignorePartsWithoutDicomPreamble =
      opts && typeof opts.ignorePartsWithoutDicomPreamble === 'boolean'
        ? opts.ignorePartsWithoutDicomPreamble
        : false;
    this._partOpts =
      typeof opts.partHighWaterMark === 'number'
        ? { highWaterMark: opts.partHighWaterMark }
        : Object.create(null);

    this._setBoundary(contentType.params.boundary);
    this._boundaryParser.push(B_CRLF);

    this._dashes = 0;
    this._parts = 0;
    this._finished = false;
    this._started = false;
    this._justMatched = false;
    this._inHeader = true;
    this._part = undefined;
    this._cb = undefined;
    this._ignoreData = false;
    this._awaitingDicomPreamble = false;
    this._preambleChunks = [];
    this._preambleBytes = 0;
    this._pause = false;

    this._headerParser = new HeaderParser(opts);
    this._headerParser.on('header', (header) => {
      this._inHeader = false;
      const contentTypeKey = header['content-type'];
      if (!contentTypeKey) {
        this._part.emit(
          'error',
          new Error('Missing Content-Type header in part. Ignoring part...')
        );
        this._part.push(null);
        this._ignore();
        return;
      }
      const contentTypeValue = contentTypeKey[0].trim().toLowerCase();
      if (contentTypeValue !== 'application/dicom') {
        this._part.emit(
          'error',
          new Error(`Unexpected part Content-Type: ${contentTypeValue}. Ignoring part...`)
        );
        this._part.push(null);
        this._ignore();
        return;
      }
      this._part.emit('header', header);
    });
    this._headerParser.on('error', (err) => {
      if (this._part && !this._ignoreData) {
        this._part.emit('error', err);
        this._part.push(null);
      }
    });
  }

  /**
   * Overrides the default emit method to handle 'finish' event with custom logic.
   * @method
   * @param {string} ev - The event name to emit.
   */
  emit(ev) {
    if (ev !== 'finish') {
      Writable.prototype.emit.apply(this, arguments);
      return;
    }

    if (this._finished) {
      return;
    }

    process.nextTick(() => {
      this.emit('error', new Error('Unexpected end of multipart data'));

      if (this._part && !this._ignoreData) {
        this._part.emit(
          'error',
          new Error('Part terminated early due to unexpected end of multipart data')
        );
        this._part.push(null);
        process.nextTick(() => {
          Writable.prototype.emit.call(this, 'finish');
        });
        return;
      }

      Writable.prototype.emit.call(this, 'finish');
    });
  }

  /**
   * Pushes data into the DicomwebMultipartParser for processing.
   * This method is used to feed data into the parser.
   * @method
   */
  reset() {
    this._part = undefined;
    this._boundaryParser = undefined;
    this._headerParser = undefined;
    this._started = false;
    this._awaitingDicomPreamble = false;
    this._preambleChunks = [];
    this._preambleBytes = 0;
  }

  //#region Private Methods
  /**
   * Sets the boundary string for the multipart parser.
   * @method
   * @private
   * @param {string} boundary - The boundary string used
   * to separate parts in the multipart data.
   */
  _setBoundary(boundary) {
    this._boundaryParser = new StreamSearch(`\r\n--${boundary}`, this._onInfo.bind(this));
  }

  /**
   * Handles incoming data chunks.
   * @method
   * @private
   * @param {Buffer} data - The chunk of data being written to the stream.
   * @param {string} encoding - The encoding of the data chunk (if it's a string).
   * @param {function} cb - The callback function to be called when processing is complete.
   */
  // eslint-disable-next-line no-unused-vars
  _write(data, encoding, cb) {
    // Ignore unexpected data after parsing has finished.
    if (!this._headerParser && !this._boundaryParser) {
      return cb();
    }

    this._boundaryParser.push(data);

    if (this._pause) {
      this._cb = cb;
    } else {
      cb();
    }
  }

  /**
   * Handles matches found by the boundary parser.
   * @method
   * @private
   * @param {boolean} isMatch - Indicates whether a boundary match was found.
   * @param {Buffer} data - The data chunk being processed.
   * @param {number} start - The starting index of the data chunk.
   * @param {number} end - The ending index of the data chunk.
   */
  _onInfo(isMatch, data, start, end) {
    let buf;
    let i = 0;
    let r;
    let shouldWriteMore = true;

    if (!this._part && this._justMatched && data) {
      while (this._dashes < 2 && start + i < end) {
        if (data[start + i] === DASH) {
          ++i;
          ++this._dashes;
        } else {
          if (this._dashes) {
            buf = B_ONEDASH;
          }
          this._dashes = 0;
          break;
        }
      }
      if (this._dashes === 2) {
        this.reset();
        this._finished = true;
        // No more parts will be added
        if (this._parts === 0) {
          Writable.prototype.emit.call(this, 'finish');
        }
      }
      if (this._dashes) {
        return;
      }
    }
    if (this._justMatched) {
      this._justMatched = false;
    }
    if (this._started && data && start < end && !this._ignoreData) {
      if (!this._part) {
        this._part = new PartStream(this._partOpts);
        this._awaitingDicomPreamble = this._ignorePartsWithoutDicomPreamble;
        this._preambleChunks = [];
        this._preambleBytes = 0;
        // eslint-disable-next-line no-unused-vars
        this._part._read = (n) => {
          this._unpause();
        };
        if (this._events.part) {
          this.emit('part', this._part);
        } else {
          this._ignore();
        }
        this._inHeader = true;
      }

      if (!this._inHeader) {
        if (buf) {
          shouldWriteMore = this._pushPartData(buf);
        }
        shouldWriteMore = this._pushPartData(data.slice(start, end));
        if (!shouldWriteMore) {
          this._pause = true;
        }
      } else {
        if (buf) {
          this._headerParser.push(buf);
        }
        r = this._headerParser.push(data.slice(start, end));
        if (!this._inHeader && r !== undefined && r < end) {
          this._onInfo(false, data, start + r, end);
        }
      }
    }
    if (isMatch) {
      this._headerParser.reset();

      if (this._part) {
        ++this._parts;
        this._part.on('end', () => {
          if (--this._parts === 0) {
            if (this._finished) {
              Writable.prototype.emit.call(this, 'finish');
            } else {
              this._unpause();
            }
          }
        });

        this._part.push(null);
        this._part = undefined;
      }

      this._started = true;
      this._ignoreData = false;
      this._justMatched = true;
      this._dashes = 0;
    }
  }

  /**
   * Pushes part data into the current part stream, handling DICOM preamble if necessary.
   * @method
   * @private
   * @param {Buffer} chunk - The chunk of data to be pushed into the part stream.
   * @returns {boolean} Returns true if the data was successfully pushed to the part stream,
   * or false if the stream is paused and cannot accept more data at the moment.
   */
  _pushPartData(chunk) {
    if (!chunk || chunk.length === 0 || this._ignoreData) {
      return true;
    }

    if (!this._awaitingDicomPreamble) {
      return this._part.push(chunk);
    }

    this._preambleChunks.push(chunk);
    this._preambleBytes += chunk.length;

    if (this._preambleBytes < DICOM_PREFIX_LENGTH) {
      return true;
    }

    const buffered = Buffer.concat(this._preambleChunks, this._preambleBytes);
    this._preambleChunks = [];
    this._preambleBytes = 0;
    this._awaitingDicomPreamble = false;

    if (!this._hasDicomPreamble(buffered) && this._ignorePartsWithoutDicomPreamble) {
      this._part.emit(
        'error',
        new Error('Part does not have a valid DICOM preamble. Ignoring part...')
      );
      this._part.push(null);
      this._ignore();
      return true;
    }

    return this._part.push(buffered);
  }

  /**
   * Checks if the buffered data contains a valid DICOM preamble.
   * A valid DICOM preamble consists of 128 bytes followed by the characters "DICM".
   * @param {Buffer} buff - The buffered data to be checked for a DICOM preamble.
   * @returns {boolean} Returns true if the buffered data contains a valid DICOM preamble,
   * or false if it does not.
   * @method
   * @private
   */
  _hasDicomPreamble(buff) {
    if (!buff || buff.length < DICOM_PREFIX_LENGTH) {
      return false;
    }

    return (
      buff[DICOM_PREAMBLE_LENGTH] === B_DICM[0] &&
      buff[DICOM_PREAMBLE_LENGTH + 1] === B_DICM[1] &&
      buff[DICOM_PREAMBLE_LENGTH + 2] === B_DICM[2] &&
      buff[DICOM_PREAMBLE_LENGTH + 3] === B_DICM[3]
    );
  }

  /**
   * Ignores the current part by marking it to ignore and
   * resuming the stream to discard any remaining data.
   * This is used when a part is determined to be invalid
   * or should not be processed further.
   * @method
   * @private
   */
  _ignore() {
    if (this._part && !this._ignoreData) {
      this._ignoreData = true;
      this._part.on('error', EMPTY_FN);
      // We must perform some kind of read on the stream even though we are
      // ignoring the data, otherwise node's Readable stream will not emit 'end'
      // after pushing null to the stream
      this._part.resume();
    }
  }

  /**
   * Unpauses the DicomwebMultipartParser if it is currently paused.
   * If a callback is waiting to be called when unpaused,
   * it will be called after unpausing.
   * @method
   * @private
   */
  _unpause() {
    if (!this._pause) {
      return;
    }

    this._pause = false;
    if (this._cb) {
      const cb = this._cb;
      this._cb = undefined;
      cb();
    }
  }

  /**
   * Parses a Content-Type header value.
   * @method
   * @private
   * @param {string} str - The Content-Type header value to be parsed.
   * @returns {Object|undefined} An object containing the parsed type,
   * subtype, and parameters, or undefined if parsing fails.
   */
  _parseContentType(str) {
    if (typeof str !== 'string' || str.length === 0) {
      return;
    }

    // Accept either a raw value ("multipart/related; ...") or a full header line
    // ("Content-Type: multipart/related; ...\r\n").
    const sepIdx = str.indexOf(':');
    if (sepIdx !== -1) {
      const headerName = str.slice(0, sepIdx).trim().toLowerCase();
      if (headerName === 'content-type') {
        str = str.slice(sepIdx + 1);
      }
    }
    str = str.trim();
    if (str.length === 0) {
      return;
    }

    const params = Object.create(null);
    let i = 0;

    // Parse type
    for (; i < str.length; ++i) {
      const code = str.charCodeAt(i);
      if (TOKEN[code] !== 1) {
        if (code !== 47 /* '/' */ || i === 0) {
          return;
        }
        break;
      }
    }
    // Check for type without subtype
    if (i === str.length) {
      return;
    }

    const type = str.slice(0, i).toLowerCase();

    // Parse subtype
    const subtypeStart = ++i;
    for (; i < str.length; ++i) {
      const code = str.charCodeAt(i);
      if (TOKEN[code] !== 1) {
        // Make sure we have a subtype
        if (i === subtypeStart) {
          return;
        }

        if (this._parseContentTypeParams(str, i, params) === undefined) {
          return;
        }
        break;
      }
    }
    // Make sure we have a subtype
    if (i === subtypeStart) {
      return;
    }

    const subtype = str.slice(subtypeStart, i).toLowerCase();

    return { type, subtype, params };
  }

  /**
   * Parses parameters from a Content-Type header value string starting at a given index.
   * @method
   * @private
   * @param {string} str - The Content-Type header value string containing parameters.
   * @param {number} i - The index at which to start parsing parameters.
   * @param {Object} params - An object to store the parsed parameters.
   * @returns {Object|undefined} The params object with parsed parameters,
   * or undefined if parsing fails.
   */
  _parseContentTypeParams(str, i, params) {
    while (i < str.length) {
      // Consume whitespace
      for (; i < str.length; ++i) {
        const code = str.charCodeAt(i);
        if (
          code !== 32 /* ' ' */ &&
          code !== 9 /* '\t' */ &&
          code !== 13 /* '\r' */ &&
          code !== 10 /* '\n' */
        ) {
          break;
        }
      }

      // Ended on whitespace
      if (i === str.length) {
        break;
      }

      // Check for malformed parameter
      if (str.charCodeAt(i++) !== 59 /* ';' */) {
        return;
      }

      // Consume whitespace
      for (; i < str.length; ++i) {
        const code = str.charCodeAt(i);
        if (
          code !== 32 /* ' ' */ &&
          code !== 9 /* '\t' */ &&
          code !== 13 /* '\r' */ &&
          code !== 10 /* '\n' */
        ) {
          break;
        }
      }

      // Ended on whitespace (malformed)
      if (i === str.length) {
        return;
      }

      let name;
      const nameStart = i;
      // Parse parameter name
      for (; i < str.length; ++i) {
        const code = str.charCodeAt(i);
        if (TOKEN[code] !== 1) {
          if (code !== 61 /* '=' */) {
            return;
          }
          break;
        }
      }

      // No value (malformed)
      if (i === str.length) {
        return;
      }

      name = str.slice(nameStart, i);
      ++i; // Skip over '='

      // No value (malformed)
      if (i === str.length) {
        return;
      }

      let value = '';
      let valueStart;
      if (str.charCodeAt(i) === 34 /* '"' */) {
        valueStart = ++i;
        let escaping = false;
        // Parse quoted value
        for (; i < str.length; ++i) {
          const code = str.charCodeAt(i);
          if (code === 92 /* '\\' */) {
            if (escaping) {
              valueStart = i;
              escaping = false;
            } else {
              value += str.slice(valueStart, i);
              escaping = true;
            }
            continue;
          }
          if (code === 34 /* '"' */) {
            if (escaping) {
              valueStart = i;
              escaping = false;
              continue;
            }
            value += str.slice(valueStart, i);
            break;
          }
          if (escaping) {
            valueStart = i - 1;
            escaping = false;
          }
          // Invalid unescaped quoted character (malformed)
          if (QDTEXT[code] !== 1) {
            return;
          }
        }

        // No end quote (malformed)
        if (i === str.length) {
          return;
        }

        ++i; // Skip over double quote
      } else {
        valueStart = i;
        // Parse unquoted value until a parameter separator or trailing whitespace.
        for (; i < str.length; ++i) {
          const code = str.charCodeAt(i);
          if (
            code === 59 /* ';' */ ||
            code === 32 /* ' ' */ ||
            code === 9 /* '\t' */ ||
            code === 13 /* '\r' */ ||
            code === 10 /* '\n' */
          ) {
            break;
          }
        }
        // No value (malformed)
        if (i === valueStart) {
          return;
        }
        value = str.slice(valueStart, i);
      }

      name = name.toLowerCase();
      if (params[name] === undefined) {
        params[name] = value;
      }
    }

    return params;
  }
  //#endregion
}
//#endregion

//#region Exports
module.exports = DicomwebMultipartParser;
//#endregion
