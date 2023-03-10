/// <reference lib="dom" />
class AudioBufferPlayer {
  private audioContext: AudioContext;
  public buffer: AudioBuffer;
  private source: AudioBufferSourceNode | null;
  private startTime: number | null;
  private trimStart: number | null;
  private trimEnd: number | null;
  private updateCallback: ((percentage: number) => void) | null;
  constructor(samples: Float32Array, sampleRate: number) {
    this.audioContext = new AudioContext();
    this.buffer = this.audioContext.createBuffer(1, samples.length, sampleRate);
    this.buffer.getChannelData(0).set(samples);
    this.source = null;

    this.startTime = null;
    this.updateCallback = null;
    this.trimStart = null;
    this.trimEnd = null;
  }

  play(
    trimStart: number,
    trimEnd: number,
    onUpdate: ((percentage: number) => void) | null,
    onEnded: AudioScheduledSourceNode["onended"]
  ) {
    this.updateCallback = onUpdate;
    if (trimEnd > trimStart) {
      this.trimStart = trimStart;
      this.trimEnd = trimEnd;
    } else {
      this.trimStart = trimEnd;
      this.trimEnd = trimStart;
    }
    this.startTime = Date.now();

    const trimStartTime = this.buffer.duration * this.trimStart;
    const trimmedDuration = this.buffer.duration * this.trimEnd - trimStartTime;

    this.source = this.audioContext.createBufferSource();
    this.source.onended = onEnded;
    this.source.buffer = this.buffer;
    this.source.connect(this.audioContext.destination);
    this.source.start(0, trimStartTime, trimmedDuration);

    this.update();
  }

  update() {
    const timeSinceStart = (Date.now() - this.startTime!) / 1000;
    const percentage = timeSinceStart / this.buffer.duration;
    if (percentage + this.trimStart! < this.trimEnd! && this.source!.onended) {
      requestAnimationFrame(this.update.bind(this));
      this.updateCallback!(percentage + this.trimStart!);
    } else {
      this.updateCallback = null;
    }
  }

  stop() {
    if (this.source) {
      this.source.onended = null; // Do not call onEnded callback if manually stopped
      try {
        this.source.stop();
      } catch (e) {
        // This is probably Safari, which dies when you call stop more than once
        // which the spec says is allowed: https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode
        console.log("Caught error while stopping buffer source node."); // eslint-disable-line no-console
      }
    }
  }
}

export default AudioBufferPlayer;
