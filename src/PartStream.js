const { Readable } = require('stream');

//#region PartStream
class PartStream extends Readable {
  /**
   * Reads the content of a DICOM part as a stream.
   * @method
   * @param {number} n - Number of bytes to read.
   */
  // eslint-disable-next-line no-unused-vars
  _read(n) {}
}
//#endregion

//#region Exports
module.exports = PartStream;
//#endregion
