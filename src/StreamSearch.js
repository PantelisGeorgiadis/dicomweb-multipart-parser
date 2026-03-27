//  Based heavily on the Streaming Boyer-Moore-Horspool C++ implementation
//  by Hongli Lai at: https://github.com/FooBarWidget/boyer-moore-horspool

//#region StreamSearch
class StreamSearch {
  /**
   * Creates an instance of StreamSearch.
   * @constructor
   * @param {Buffer|string} needle - The pattern to search for.
   * @param {function} cb - Callback function to call on a match.
   */
  constructor(needle, cb) {
    if (typeof cb !== 'function') {
      throw new Error('Missing match callback');
    }

    if (typeof needle === 'string') {
      needle = Buffer.from(needle);
    } else if (!Buffer.isBuffer(needle)) {
      throw new Error(`Expected Buffer for needle, got ${typeof needle}`);
    }

    const needleLen = needle.length;

    this.maxMatches = Infinity;
    this.matches = 0;
    this._cb = cb;
    this._lookbehindSize = 0;
    this._needle = needle;
    this._bufPos = 0;
    this._lookbehind = Buffer.allocUnsafe(needleLen);

    // Initialize occurrence table.
    // prettier-ignore
    this._occ = [
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen, needleLen, needleLen,
      needleLen, needleLen, needleLen, needleLen
    ];

    // Populate occurrence table with analysis of the needle,
    // ignoring the last letter.
    if (needleLen > 1) {
      for (let i = 0; i < needleLen - 1; ++i) {
        this._occ[needle[i]] = needleLen - 1 - i;
      }
    }
  }

  /**
   * Resets the StreamSearch instance.
   * @method
   */
  reset() {
    this.matches = 0;
    this._lookbehindSize = 0;
    this._bufPos = 0;
  }

  /**
   * Feeds a chunk of data into the StreamSearch instance and performs the search for the needle.
   * @param {Buffer|string} chunk - The data chunk to search through.
   * @param {number} [pos] - Optional position in the chunk to start searching from.
   * If not provided, starts from the beginning of the chunk.
   * @returns {number} The position in the chunk up to which the search has been performed.
   */
  push(chunk, pos) {
    let result;
    if (!Buffer.isBuffer(chunk)) {
      chunk = Buffer.from(chunk, 'latin1');
    }
    const chunkLen = chunk.length;
    this._bufPos = pos || 0;
    while (result !== chunkLen && this.matches < this.maxMatches) {
      result = this._feed(chunk);
    }

    return result;
  }

  /**
   * Destroys the StreamSearch instance,
   * performing a final callback with any remaining lookbehind data.
   * @method
   */
  destroy() {
    const lbSize = this._lookbehindSize;
    if (lbSize) {
      this._cb(false, this._lookbehind, 0, lbSize, false);
    }
    this.reset();
  }

  //#region Private Methods
  /**
   * Feeds data into the StreamSearch instance and performs
   * the search for the needle in the given data chunk.
   * @method
   * @private
   * @param {Buffer} data - The data chunk to search through.
   * @returns {number} The position in the data chunk up to which the search has been performed.
   */
  _feed(data) {
    const len = data.length;
    const needle = this._needle;
    const needleLen = needle.length;

    // Positive: points to a position in `data`
    //           pos == 3 points to data[3]
    // Negative: points to a position in the lookbehind buffer
    //           pos == -2 points to lookbehind[lookbehindSize - 2]
    let pos = -this._lookbehindSize;
    const lastNeedleCharPos = needleLen - 1;
    const lastNeedleChar = needle[lastNeedleCharPos];
    const end = len - needleLen;
    const occ = this._occ;
    const lookbehind = this._lookbehind;

    if (pos < 0) {
      // Lookbehind buffer is not empty. Perform Boyer-Moore-Horspool
      // search with character lookup code that considers both the
      // lookbehind buffer and the current round's haystack data.
      //
      // Loop until
      //   there is a match.
      // or until
      //   we've moved past the position that requires the
      //   lookbehind buffer. In this case we switch to the
      //   optimized loop.
      // or until
      //   the character to look at lies outside the haystack.
      while (pos < 0 && pos <= end) {
        const nextPos = pos + lastNeedleCharPos;
        const ch = nextPos < 0 ? lookbehind[this._lookbehindSize + nextPos] : data[nextPos];

        if (ch === lastNeedleChar && this._matchNeedle(data, pos, lastNeedleCharPos)) {
          this._lookbehindSize = 0;
          ++this.matches;
          if (pos > -this._lookbehindSize) {
            this._cb(true, lookbehind, 0, this._lookbehindSize + pos, false);
          } else {
            this._cb(true, undefined, 0, 0, true);
          }

          return (this._bufPos = pos + needleLen);
        }

        pos += occ[ch];
      }

      // No match.

      // There's too few data for Boyer-Moore-Horspool to run,
      // so let's use a different algorithm to skip as much as
      // we can.
      // Forward pos until
      //   the trailing part of lookbehind + data
      //   looks like the beginning of the needle
      // or until
      //   pos == 0
      while (pos < 0 && !this._matchNeedle(data, pos, len - pos)) {
        ++pos;
      }

      if (pos < 0) {
        // Cut off part of the lookbehind buffer that has
        // been processed and append the entire haystack
        // into it.
        const bytesToCutOff = this._lookbehindSize + pos;
        if (bytesToCutOff > 0) {
          // The cut off data is guaranteed not to contain the needle.
          this._cb(false, lookbehind, 0, bytesToCutOff, false);
        }

        this._lookbehindSize -= bytesToCutOff;
        lookbehind.copy(lookbehind, 0, bytesToCutOff, this._lookbehindSize);
        lookbehind.set(data, this._lookbehindSize);
        this._lookbehindSize += len;

        this._bufPos = len;

        return len;
      }

      // Discard lookbehind buffer.
      this._cb(false, lookbehind, 0, this._lookbehindSize, false);
      this._lookbehindSize = 0;
    }

    pos += this._bufPos;

    const firstNeedleChar = needle[0];

    // Lookbehind buffer is now empty. Perform Boyer-Moore-Horspool
    // search with optimized character lookup code that only considers
    // the current round's haystack data.
    while (pos <= end) {
      const ch = data[pos + lastNeedleCharPos];
      if (
        ch === lastNeedleChar &&
        data[pos] === firstNeedleChar &&
        StreamSearch._memcmp(needle, 0, data, pos, lastNeedleCharPos)
      ) {
        ++this.matches;
        if (pos > 0) {
          this._cb(true, data, this._bufPos, pos, true);
        } else {
          this._cb(true, undefined, 0, 0, true);
        }

        return (this._bufPos = pos + needleLen);
      }

      pos += occ[ch];
    }

    // There was no match. If there's trailing haystack data that we cannot
    // match yet using the Boyer-Moore-Horspool algorithm (because the trailing
    // data is less than the needle size) then match using a modified
    // algorithm that starts matching from the beginning instead of the end.
    // Whatever trailing data is left after running this algorithm is added to
    // the lookbehind buffer.
    while (pos < len) {
      if (data[pos] !== firstNeedleChar || !StreamSearch._memcmp(data, pos, needle, 0, len - pos)) {
        ++pos;
        continue;
      }
      data.copy(lookbehind, 0, pos, len);
      this._lookbehindSize = len - pos;
      break;
    }

    // Everything until `pos` is guaranteed not to contain needle data.
    if (pos > 0) {
      this._cb(false, data, this._bufPos, pos < len ? pos : len, true);
    }

    this._bufPos = len;

    return len;
  }

  /**
   * Checks if the needle matches the data at the given position, considering
   * both the lookbehind buffer and the current round's haystack data.
   * @method
   * @private
   * @param {Buffer} data - The current round's haystack data.
   * @param {number} pos - The position to check for a match, can be negative to indicate lookbehind buffer.
   * @param {number} len - The number of bytes to check for a match.
   * @returns {boolean} True if the needle matches, false otherwise.
   */
  _matchNeedle(data, pos, len) {
    const lb = this._lookbehind;
    const lbSize = this._lookbehindSize;
    const needle = this._needle;

    for (let i = 0; i < len; ++i, ++pos) {
      const ch = pos < 0 ? lb[lbSize + pos] : data[pos];
      if (ch !== needle[i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Copies `num` bytes from `buf2` at position `pos2` to `buf1` at position `pos1`
   * and returns true if all copied bytes are the same, false otherwise.
   * @method
   * @static
   * @private
   * @param {Buffer} buf1 - The buffer to copy to.
   * @param {number} pos1 - The position in `buf1` to start copying to.
   * @param {Buffer} buf2 - The buffer to copy from.
   * @param {number} pos2 - The position in `buf2` to start copying from.
   * @param {number} num - The number of bytes to copy and compare.
   * @returns {boolean} True if all copied bytes are the same, false otherwise.
   */
  static _memcmp(buf1, pos1, buf2, pos2, num) {
    for (let i = 0; i < num; ++i) {
      if (buf1[pos1 + i] !== buf2[pos2 + i]) {
        return false;
      }
    }

    return true;
  }
  //#endregion
}
//#endregion

//#region Exports
module.exports = StreamSearch;
//#endregion
