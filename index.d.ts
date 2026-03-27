/// <reference types="node" />

import { Writable, WritableOptions, Readable } from 'stream';

/** Parsed MIME headers for a part: each key maps to an array of values. */
declare type PartHeaders = Record<string, string[]>;

/** Options accepted by the DicomDicer constructor. */
declare interface DicomDicerOptions extends WritableOptions {
  /** HTTP headers object. Must include a `content-type` field. */
  headers: Record<string, string> & { 'content-type': string };
  /**
   * Desired high water mark (in bytes) for each part's Readable stream.
   * @default 16384
   */
  partHighWaterMark?: number;
  /**
   * When `true`, parts that lack a valid DICOM preamble are silently
   * discarded rather than causing an `'error'` event on the part stream.
   * @default false
   */
  ignorePartsWithoutDicomPreamble?: boolean;
  /**
   * Maximum number of header field/value pairs accepted per part.
   * @default 2000
   */
  maxHeaderPairs?: number;
}

/** Readable stream representing a single MIME part inside a multipart/related body. */
declare class PartStream extends Readable {
  /** Emitted once the part's MIME headers have been parsed. */
  on(event: 'header', listener: (header: PartHeaders) => void): this;
  /** Emitted when this part should be discarded due to a validation failure. */
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'data', listener: (chunk: Buffer) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this;
}

/** Streaming MIME multipart/related parser for DICOM STOW-RS. */
declare class DicomDicer extends Writable {
  constructor(opts: DicomDicerOptions);

  /** Resets internal state so the instance can be re-used. */
  reset(): void;

  /** Emitted for every MIME part found in the multipart stream. */
  on(event: 'part', listener: (part: PartStream) => void): this;
  on(event: 'finish', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this;
}

declare namespace DicomDicer {
  export { DicomDicerOptions, PartHeaders, PartStream };
}

export = DicomDicer;
