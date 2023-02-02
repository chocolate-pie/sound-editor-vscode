import { convert } from "./utils/float32array-to-int16array";
type EncodeType = {
  channels: number;
  sampleRate: number;
  samples: Float32Array;
};
const encode = (arg: EncodeType) => {
  const { samples, sampleRate, channels } = arg;
  const kbps = 128;
  // @ts-ignore
  const lameInstance = new lamejs();
  const mp3Encoder = lameInstance.Mp3Encoder(channels, sampleRate, kbps);
  const sampleBlockSize = 1152;
  const mp3Data = [];
  const newSamples = convert(samples);
  var sampleChunk;
  for (let i = 0; i < newSamples.length; i += sampleBlockSize) {
    sampleChunk = newSamples.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3Encoder.encodeBuffer(sampleChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
  }
  const mp3buf = mp3Encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }
  const blob = new Blob(mp3Data, { type: "audio/mpeg" });
  return blob.arrayBuffer();
};

export { encode };
