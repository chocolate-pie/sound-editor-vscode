/* eslint curly: off */
const SOUND_BYTE_LIMIT = 10 * 1000 * 1000; // 10mb

const computeRMS = function (samples: ArrayLike<any>, scaling = 0.55) {
  if (samples.length === 0) return 0;
  // Calculate RMS, adapted from https://github.com/Tonejs/Tone.js/blob/master/Tone/component/Meter.js#L88
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    sum += Math.pow(sample, 2);
  }
  const rms = Math.sqrt(sum / samples.length);
  const val = rms / scaling;
  return Math.sqrt(val);
};

const computeChunkedRMS = function (samples: Float32Array, chunkSize = 1024) {
  const sampleCount = samples.length;
  const chunkLevels = [];
  for (let i = 0; i < sampleCount; i += chunkSize) {
    const maxIndex = Math.min(sampleCount, i + chunkSize);
    chunkLevels.push(computeRMS(samples.slice(i, maxIndex)));
  }
  return chunkLevels;
};

const downsampleIfNeeded = (buffer: { samples: Float32Array, sampleRate: number }, resampler: (Buffer: { samples: Float32Array, sampleRate: number }, khz: number) => Promise<{ samples: Float32Array, sampleRate: number }>) => {
  const {samples, sampleRate} = buffer;
  const duration = samples.length / sampleRate;
  const encodedByteLength = samples.length * 2; /* bitDepth 16 bit */
  // Resolve immediately if already within byte limit
  if (encodedByteLength < SOUND_BYTE_LIMIT) {
      return Promise.resolve({samples, sampleRate});
  }
  // If encodeable at 22khz, resample and call submitNewSamples again
  if (duration * 22050 * 2 < SOUND_BYTE_LIMIT) {
      return resampler({samples, sampleRate}, 22050);
  }
  // Cannot save this sound at 22khz, refuse to edit
  // In the future we could introduce further compression here
  return Promise.reject(new Error('Sound too large to save, refusing to edit'));
};

const dropEveryOtherSample = (buffer: { samples: Float32Array, sampleRate: number }) => {
  const newLength = Math.floor(buffer.samples.length / 2);
  const newSamples = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
      newSamples[i] = buffer.samples[i * 2];
  }
  return {
      samples: newSamples,
      sampleRate: buffer.sampleRate / 2
  };
};

export { computeChunkedRMS, dropEveryOtherSample, downsampleIfNeeded };
