/// <reference lib="dom" />
class VolumeEffect {
  private audioContext: OfflineAudioContext;
  public input: GainNode;
  public output: GainNode;
  private gain: GainNode;
  private rampLength: number;
  constructor(
    audioContext: OfflineAudioContext,
    volume: number,
    startSeconds: number,
    endSeconds: number
  ) {
    this.audioContext = audioContext;

    this.input = this.audioContext.createGain();
    this.output = this.audioContext.createGain();

    this.gain = this.audioContext.createGain();

    // Smoothly ramp the gain up before the start time, and down after the end time.
    this.rampLength = 0.01;
    this.gain.gain.setValueAtTime(
      1.0,
      Math.max(0, startSeconds - this.rampLength)
    );
    this.gain.gain.exponentialRampToValueAtTime(volume, startSeconds);
    this.gain.gain.setValueAtTime(volume, endSeconds);
    this.gain.gain.exponentialRampToValueAtTime(
      1.0,
      endSeconds + this.rampLength
    );

    this.input.connect(this.gain);
    this.gain.connect(this.output);
  }
}

export default VolumeEffect;
