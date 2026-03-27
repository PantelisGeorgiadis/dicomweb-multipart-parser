const EventEmitter = require('events');
const StreamSearch = require('./StreamSearch');

const B_DCRLF = Buffer.from('\r\n\r\n');
const MAX_HEADER_PAIRS = 2000; // From node's http.js
const MAX_HEADER_SIZE = 80 * 1024; // From node's http_parser

//#region HeaderParser
class HeaderParser extends EventEmitter {
  /**
   * Creates an instance of HeaderParser.
   * @constructor
   * @param {Object} [opts] - Configuration options.
   * @param {number} [opts.maxHeaderPairs] - Maximum number of header pairs.
   * @param {number} [opts.maxHeaderSize] - Maximum header size.
   */
  constructor(opts) {
    super();

    this._nRead = 0;
    this._maxed = false;
    this._nPairs = 0;
    this._buffer = '';
    this._header = Object.create(null);
    this._finished = false;

    this._maxHeaderPairs =
      opts && typeof opts.maxHeaderPairs === 'number' ? opts.maxHeaderPairs : MAX_HEADER_PAIRS;

    this.streamSearch = new StreamSearch(B_DCRLF, (isMatch, data, start, end) => {
      if (data && !this._maxed) {
        if (this._nRead + (end - start) > MAX_HEADER_SIZE) {
          end = MAX_HEADER_SIZE - this._nRead + start;
          this._nRead = MAX_HEADER_SIZE;
        } else {
          this._nRead += end - start;
        }

        if (this._nRead === MAX_HEADER_SIZE) {
          this._maxed = true;
        }

        this._buffer += data.toString('latin1', start, end);
      }
      if (isMatch) {
        this._finish();
      }
    });
  }

  /**
   * Pushes data into the header parser.
   * @method
   * @param {Buffer|string} data - The data to be parsed as header content.
   * @returns {number|undefined} The number of bytes processed.
   */
  push(data) {
    const r = this.streamSearch.push(data);
    if (this._finished) {
      return r;
    }
  }

  /**
   * Resets the header parser to its initial state.
   * @method
   */
  reset() {
    this._finished = false;
    this._buffer = '';
    this._header = Object.create(null);
    this.streamSearch.reset();
  }

  //#region Private Methods
  /**
   * Finalizes the header parsing process.
   * This method is called when the end of the header section is detected.
   * @method
   * @private
   */
  _finish() {
    let hadError = false;
    if (this._buffer) {
      hadError = !this._parseHeader();
    }
    this.streamSearch.matches = this.streamSearch.maxMatches;
    const header = this._header;
    this._header = Object.create(null);
    this._buffer = '';
    this._finished = true;
    this._nRead = this._nPairs = 0;
    this._maxed = false;

    if (!hadError) {
      this.emit('header', header);
    }
  }

  /**
   * Parses the buffered header data. It processes the header lines,
   * handles folded headers, and populates the header object.
   * @returns {boolean} Returns true if parsing was successful,
   * or false if an error occurred.
   * @method
   * @private
   */
  _parseHeader() {
    if (this._nPairs === this._maxHeaderPairs) {
      return true;
    }

    const lines = this._buffer.split('\r\n');
    const len = lines.length;
    let h;
    let modded = false;

    for (let i = 0; i < len; ++i) {
      if (lines[i].length === 0) {
        continue;
      }

      if (lines[i][0] === '\t' || lines[i][0] === ' ') {
        // Folded header content
        // RFC2822 says to just remove the CRLF and not the whitespace following
        // it, so we follow the RFC and include the leading whitespace ...
        if (!h) {
          this.emit('error', new Error('Unexpected folded header value'));
          return false;
        }
        this._header[h][this._header[h].length - 1] += lines[i];
      } else {
        const colonIdx = lines[i].indexOf(':');
        if (colonIdx > 0) {
          h = lines[i].slice(0, colonIdx).toLowerCase();
          let val = lines[i].slice(colonIdx + 1);
          if (val.length > 0 && (val[0] === ' ' || val[0] === '\t')) {
            val = val.slice(1);
          }
          if (val) {
            if (this._header[h] === undefined) {
              this._header[h] = [val];
            } else {
              this._header[h].push(val);
            }
          } else {
            this._header[h] = [''];
          }
          if (++this._nPairs === this._maxHeaderPairs) {
            break;
          }
        } else {
          this._buffer = lines[i];
          modded = true;
          break;
        }
      }
    }
    if (!modded) {
      this._buffer = '';
    }

    return true;
  }
  //#endregion
}
//#endregion

//#region Exports
module.exports = HeaderParser;
//#endregion
