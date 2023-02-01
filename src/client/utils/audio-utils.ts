/* eslint curly: off */
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

export { computeChunkedRMS };