import { expectType } from 'tsd';
import DicomwebMultipartParser from '.';

const validOpts: DicomwebMultipartParser.DicomwebMultipartParserOptions = {
  headers: {
    'content-type': 'multipart/related; type="application/dicom"; boundary=myboundary',
  },
};

const parser = new DicomwebMultipartParser(validOpts);
expectType<DicomwebMultipartParser>(parser);

// All optional fields are accepted
new DicomwebMultipartParser({
  headers: { 'content-type': 'multipart/related; boundary=x' },
  partHighWaterMark: 65536,
  ignorePartsWithoutDicomPreamble: true,
  maxHeaderPairs: 100,
});

expectType<void>(parser.reset());

expectType<DicomwebMultipartParser>(
  parser.on('part', (part: DicomwebMultipartParser.PartStream) => {
    expectType<DicomwebMultipartParser.PartStream>(part);

    expectType<DicomwebMultipartParser.PartStream>(
      part.on('header', (header: DicomwebMultipartParser.PartHeaders) => {
        expectType<DicomwebMultipartParser.PartHeaders>(header);
      })
    );

    expectType<DicomwebMultipartParser.PartStream>(
      part.on('error', (err) => {
        expectType<Error>(err);
      })
    );

    expectType<DicomwebMultipartParser.PartStream>(part.on('end', () => {}));
  })
);

expectType<DicomwebMultipartParser>(parser.on('finish', () => {}));

expectType<DicomwebMultipartParser>(
  parser.on('error', (err: Error) => {
    expectType<Error>(err);
  })
);
