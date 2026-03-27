import { expectType } from 'tsd';
import DicomDicer from '.';

const validOpts: DicomDicer.DicomDicerOptions = {
  headers: {
    'content-type': 'multipart/related; type="application/dicom"; boundary=myboundary',
  },
};

const dicer = new DicomDicer(validOpts);
expectType<DicomDicer>(dicer);

// All optional fields are accepted
new DicomDicer({
  headers: { 'content-type': 'multipart/related; boundary=x' },
  partHighWaterMark: 65536,
  ignorePartsWithoutDicomPreamble: true,
  maxHeaderPairs: 100,
});

expectType<void>(dicer.reset());

expectType<DicomDicer>(
  dicer.on('part', (part: DicomDicer.PartStream) => {
    expectType<DicomDicer.PartStream>(part);

    expectType<DicomDicer.PartStream>(
      part.on('header', (header: DicomDicer.PartHeaders) => {
        expectType<DicomDicer.PartHeaders>(header);
      })
    );

    expectType<DicomDicer.PartStream>(
      part.on('error', (err) => {
        expectType<Error>(err);
      })
    );

    expectType<DicomDicer.PartStream>(part.on('end', () => {}));
  })
);

expectType<DicomDicer>(dicer.on('finish', () => {}));

expectType<DicomDicer>(
  dicer.on('error', (err: Error) => {
    expectType<Error>(err);
  })
);
