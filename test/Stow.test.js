const DicomDicer = require('./../src/DicomDicer');

const { PromiseSocket } = require('promise-socket');
const http = require('http');
const net = require('net');
const chai = require('chai');
const dcmjs = require('dcmjs');

const expect = chai.expect;
const { DicomDict, DicomMetaDictionary } = dcmjs.data;

function guid() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  }
  return `${s4() + s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

function getRandomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createDicomPart10FromGrayscaleRandomImage(width, height, bits, writeOptions = {}) {
  const imageData = new Uint8Array(
    new Array((bits / 8) * width * height).fill(0).map(() => getRandomInteger(0, 255))
  );
  const elements = {
    _meta: {
      FileMetaInformationVersion: new Uint8Array([0, 1]).buffer,
      ImplementationClassUID: '1.2.3.4.5.6.7.8.9.0',
      ImplementationVersionName: 'TEST',
      MediaStorageSOPClassUID: '1.2.840.10008.5.1.4.1.1.7', // Secondary Capture Image Storage
      MediaStorageSOPInstanceUID: DicomMetaDictionary.uid(),
      TransferSyntaxUID: '1.2.840.10008.1.2.1', // Explicit VR Little Endian
    },
    _vrMap: {
      PixelData: bits === 16 ? 'OW' : 'OB',
    },
    BitsAllocated: bits,
    BitsStored: bits,
    Columns: width,
    HighBit: bits - 1,
    NumberOfFrames: 1,
    PhotometricInterpretation: 'MONOCHROME2',
    PixelData: [
      imageData.buffer.slice(imageData.byteOffset, imageData.byteOffset + imageData.byteLength),
    ],
    PixelRepresentation: 0,
    Rows: height,
    SamplesPerPixel: 1,
  };
  const denaturalizedMetaHeader = DicomMetaDictionary.denaturalizeDataset(elements._meta);
  const dicomDict = new DicomDict(denaturalizedMetaHeader);
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(elements);

  return Buffer.from(dicomDict.write(writeOptions));
}

async function createAndUploadDicomPart10(pSocket, width, height, bits, boundary) {
  const contentType = 'application/dicom';
  const contentTypeString = `Content-Type: ${contentType}`;
  const header = `\r\n--${boundary}\r\n${contentTypeString}\r\n\r\n`;
  const partBuffer = Buffer.concat([
    Buffer.from(header),
    createDicomPart10FromGrayscaleRandomImage(width, height, bits),
  ]);
  await pSocket.write(`${partBuffer.length.toString(16)}\r\n`);
  await pSocket.write(partBuffer);
  await pSocket.write(`\r\n`);
}

describe('DicomDicer Integration', () => {
  it('should correctly perform basic multipart parsing', async () => {
    const port = 3000;
    const boundary = guid();

    let partCount = 0;

    const server = http
      .createServer((req, res) => {
        let m;
        if (req.method === 'POST' && req.url === '/studies') {
          const dicomDicer = new DicomDicer({ headers: req.headers });
          dicomDicer.on('part', (dicomPart) => {
            const chunks = [];
            dicomPart.on('header', (header) => {
              console.log('Received part headers:');
              for (const h in header) {
                console.log(`    ${h}: ${header[h]}`);
              }
            });
            dicomPart.on('data', (data) => {
              chunks.push(data);
            });
            dicomPart.on('end', () => {
              const partData = Buffer.concat(chunks);
              console.log(`End of part. Part data length: ${partData.length}`);
              partCount += 1;
            });
            dicomPart.on('error', (err) => {
              console.error(`Error in part: ${err.message}`);
            });
          });
          dicomDicer.on('finish', () => {
            console.log('Finished processing all parts');
            expect(partCount).to.equal(4);

            res.writeHead(200);
            res.end();
          });
          req.pipe(dicomDicer);
        }
      })
      .listen(port);

    const url = new URL(`http://localhost:${port}/studies`);
    const socket = new net.Socket();
    const pSocket = new PromiseSocket(socket);
    await pSocket.connect({ port, host: url.hostname });
    await pSocket.write(`POST ${url.pathname} HTTP/1.1\r\n`);
    await pSocket.write(`Host: ${url.hostname}\r\n`);
    await pSocket.write(
      `Content-Type: multipart/related; type=application/dicom; boundary=${boundary}\r\n`
    );
    await pSocket.write(`Transfer-Encoding: chunked\r\n`);
    await pSocket.write(`\r\n`);

    await createAndUploadDicomPart10(pSocket, 128, 128, 8, boundary);
    await createAndUploadDicomPart10(pSocket, 512, 512, 8, boundary);
    await createAndUploadDicomPart10(pSocket, 1024, 1024, 16, boundary);
    await createAndUploadDicomPart10(pSocket, 2048, 2048, 16, boundary);

    const closingBuffer = Buffer.from(`\r\n--${boundary}--`);
    await pSocket.write(`${closingBuffer.length.toString(16)}\r\n`);
    await pSocket.write(closingBuffer);
    await pSocket.write(`\r\n`);

    await pSocket.write(`0\r\n\r\n`);
    await pSocket.end();

    server.close();
  });
});
