/// <reference lib="dom" />
/// <reference path="./../types.d.ts" />
import AudioBufferPlayer from "./audio-buffer-player";
import AudioEffects from "./audio-effects";
import { analyze } from "./peak-analyzer";
import { computeChunkedRMS, dropEveryOtherSample, downsampleIfNeeded } from "./utils/audio-utils";
import * as WavEncoder from "./wav-encoder";
import * as Mp3Encoder from "./mp3-encoder";
declare global {
  interface Window {
    webkitAudioContext: new (
      contextOptions?: AudioContextOptions | undefined
    ) => AudioContext;
    }
};
type ValueOf<T> = T[keyof T];
(() => {
  const vscode = acquireVsCodeApi();
  class SoundEditorClient {
    private context: AudioContext;
    private audioBufferPlayer: null | AudioBufferPlayer;
    private state: {
      trimStart: number | null;
      trimEnd: number | null;
      playHead: number | null;
      chunkLevels: null | number[];
      isTrimmerMouseDown: boolean;
      copyBuffer: {
        samples: Float32Array;
        sampleRate: number;
      } | null;
    };
    private containerState: {
      isMouseDown: boolean;
      isTrimStartRecognized: boolean;
    };
    public ext: string | undefined;
    constructor() {
      this.context = new AudioContext() || new window.webkitAudioContext();
      this.audioBufferPlayer = null;
      this.state = {
        trimStart: null,
        trimEnd: null,
        playHead: null,
        chunkLevels: null,
        isTrimmerMouseDown: false,
        copyBuffer: null,
      };
      this.containerState = {
        isMouseDown: false,
        isTrimStartRecognized: false,
      };
    }
    get metadata() {
      return JSON.parse(document.getElementById("metadata")!.innerText);
    }
    copyCurrentBuffer() {
      // Cannot reliably use props.samples because it gets detached by Firefox
      return {
        samples: this.audioBufferPlayer!.buffer.getChannelData(0),
        sampleRate: this.audioBufferPlayer!.buffer.sampleRate,
      };
    }
    init(initAudioData: Uint8Array) {
      this.context.decodeAudioData(initAudioData.buffer).then((buffer) => {
        this.audioBufferPlayer = new AudioBufferPlayer(
          buffer.getChannelData(0),
          buffer.sampleRate
        );
        this.state = {
          ...this.state,
          chunkLevels: computeChunkedRMS(buffer.getChannelData(0)),
        };
        analyze(
          this.state.chunkLevels!,
          document.getElementById("draw-path") as any
        );
      });
    }
    update(data: any) {
      if (typeof data.channel === "undefined") {
        return;
      }
      const newBuffer = this.context.createBuffer(
        1,
        data.channel.length,
        this.audioBufferPlayer!.buffer.sampleRate
      );
      newBuffer.getChannelData(0).set(data.channel);
      this.audioBufferPlayer!.buffer = newBuffer;
      //  .getChannelData(0)
      //  .set(new Float32Array(data.channel));
      this.state = {
        ...this.state,
        chunkLevels: computeChunkedRMS(
          this.audioBufferPlayer!.buffer.getChannelData(0)
        ),
      };
      analyze(
        this.state.chunkLevels!,
        document.getElementById("draw-path") as any
      );
    }
    handlePlay() {
      this.audioBufferPlayer!.stop();
      this.audioBufferPlayer!.play(
        this.state.trimStart || 0,
        this.state.trimEnd || 1,
        this.handleUpdatePlayHead.bind(this),
        this.handleStoppedPlaying.bind(this)
      );
    }
    handleUpdatePlayHead(playHead: number) {
      this.state = {
        ...this.state,
        playHead,
      };
      document.getElementById("play-head")!.style.left = `${
        100 * this.state.playHead!
      }%`;
      document.getElementById("play-head")!.style.opacity = "1";
    }
    handleStoppedPlaying() {
      this.state = {
        ...this.state,
        playHead: null,
      };
      document.getElementById("play-head")!.style.opacity = "0";
    }
    handleStopPlaying() {
      this.audioBufferPlayer!.stop();
      this.handleStoppedPlaying();
    }
    getAudioData() {
      return new Promise((resolve: (buffer: Uint8Array) => void) => {
        if (this.ext! === ".wav") {
          WavEncoder.encode({
            sampleRate: this.audioBufferPlayer!.buffer.sampleRate,
            channelData: [this.audioBufferPlayer!.buffer.getChannelData(0)],
          }).then((buffer: ArrayBuffer) => {
            resolve(new Uint8Array(buffer));
          });
        } else {
          // Its not work XD
          Mp3Encoder.encode({
            sampleRate: this.audioBufferPlayer!.buffer.sampleRate,
            channels: this.audioBufferPlayer!.buffer.numberOfChannels,
            samples: this.audioBufferPlayer!.buffer.getChannelData(0),
          }).then((buffer: ArrayBuffer) => {
            resolve(new Uint8Array(buffer));
          });
        }
      });
    }
    submitNewSamples(
      samples: Float32Array,
      sampleRate: number,
      skipUndo?: boolean
    ) {
      skipUndo = typeof skipUndo === "undefined" ? false : skipUndo;
      return new Promise((resolve) => {
        downsampleIfNeeded({ samples, sampleRate }, this.resampleBufferToRate.bind(this)).then(({samples: newSamples, sampleRate: newSampleRate}) => {
          if (skipUndo === false) {
            // Bugzilla Error: client.js:819 Uncaught (in promise) RangeError: offset is out of bounds;
            // @see https://bugzilla.mozilla.org/show_bug.cgi?id=1245495
            // this.audioBufferPlayer!.buffer.getChannelData(0).set(samples);
            const newBuffer = this.context.createBuffer(
              1,
              newSamples.length,
              newSampleRate
            );
            newBuffer.getChannelData(0).set(newSamples);
            this.audioBufferPlayer!.buffer = newBuffer;
            vscode.postMessage({
              type: "audio",
              channel: Array.from(newSamples),
            });
            this.state = {
              ...this.state,
              chunkLevels: computeChunkedRMS(
                this.audioBufferPlayer!.buffer.getChannelData(0)
              ),
            };
            analyze(
              this.state.chunkLevels!,
              document.getElementById("draw-path") as any
            );
          }
          resolve(true);
        }).catch((err: string) => {
          vscode.postMessage({
            type: "error",
            body: err,
          });
          resolve(false);
        });
      });
    }
    handleEffect(name: ValueOf<typeof AudioEffects.effectTypes>) {
      const trimStart =
        this.state.trimStart === null ? 0.0 : this.state.trimStart;
      const trimEnd = this.state.trimEnd === null ? 1.0 : this.state.trimEnd;

      // Offline audio context needs at least 2 samples
      if (this.audioBufferPlayer!.buffer.length < 2) {
        return;
      }
      const effects = new AudioEffects(
        this.audioBufferPlayer!.buffer,
        name,
        trimEnd > trimStart ? trimStart : trimEnd,
        trimEnd > trimStart ? trimEnd : trimStart
      );
      effects.process((renderedBuffer, adjustedTrimStart, adjustedTrimEnd) => {
        const samples = renderedBuffer.getChannelData(0);
        const sampleRate = renderedBuffer.sampleRate;
        this.submitNewSamples(samples, sampleRate).then((success) => {
          if (success) {
            if (this.state.trimStart === null) {
              this.handlePlay();
            } else {
              this.state = {
                ...this.state,
                trimStart: adjustedTrimStart,
                trimEnd: adjustedTrimEnd,
              };
              this.renderTrimmer();
              this.handlePlay();
            }
          }
        });
      });
    }
    effectFactory(name: ValueOf<typeof AudioEffects.effectTypes>) {
      return () => this.handleEffect(name);
    }
    handleCopy() {
      this.copy();
    }
    handlePaste() {
      if (this.state.copyBuffer !== null) {
        this.paste();
      }
    }
    copy() {
      const _trimStart =
        this.state.trimStart === null ? 0.0 : this.state.trimStart;
      const _trimEnd = this.state.trimEnd === null ? 1.0 : this.state.trimEnd;
      let trimStart: number;
      let trimEnd: number;
      if (_trimEnd > _trimStart) {
        trimStart = _trimStart;
        trimEnd = _trimEnd;
      } else {
        trimStart = _trimEnd;
        trimEnd = _trimStart;
      }
      const newCopyBuffer = this.copyCurrentBuffer();
      const trimStartSamples = trimStart * newCopyBuffer.samples.length;
      const trimEndSamples = trimEnd * newCopyBuffer.samples.length;
      newCopyBuffer.samples = newCopyBuffer.samples.slice(
        trimStartSamples,
        trimEndSamples
      );

      this.state = {
        ...this.state,
        copyBuffer: newCopyBuffer,
      };
    }
    paste() {
      // If there's no selection, paste at the end of the sound
      const { samples } = this.copyCurrentBuffer();
      if (this.state.trimStart === null) {
        const newLength =
          samples.length + this.state.copyBuffer!.samples.length;
        const newSamples = new Float32Array(newLength);
        newSamples.set(samples, 0);
        newSamples.set(this.state.copyBuffer!.samples, samples.length);
        this.submitNewSamples(
          newSamples,
          this.audioBufferPlayer!.buffer.sampleRate,
          false
        ).then((success) => {
          if (success) {
            this.handlePlay();
          }
        });
      } else {
        // else replace the selection with the pasted sound
        const trimStartSamples = this.state.trimStart * samples.length;
        const trimEndSamples = this.state.trimEnd! * samples.length;
        const firstPart = samples.slice(0, trimStartSamples);
        const lastPart = samples.slice(trimEndSamples);
        const newLength =
          firstPart.length +
          this.state.copyBuffer!.samples.length +
          lastPart.length;
        const newSamples = new Float32Array(newLength);
        newSamples.set(firstPart, 0);
        newSamples.set(this.state.copyBuffer!.samples, firstPart.length);
        newSamples.set(
          lastPart,
          firstPart.length + this.state.copyBuffer!.samples.length
        );

        const trimStartSeconds =
          trimStartSamples / this.audioBufferPlayer!.buffer.sampleRate;
        const trimEndSeconds =
          trimStartSeconds +
          this.state.copyBuffer!.samples.length /
            this.state.copyBuffer!.sampleRate;
        const newDurationSeconds =
          newSamples.length / this.state.copyBuffer!.sampleRate;
        const adjustedTrimStart = trimStartSeconds / newDurationSeconds;
        const adjustedTrimEnd = trimEndSeconds / newDurationSeconds;
        this.submitNewSamples(
          newSamples,
          this.audioBufferPlayer!.buffer.sampleRate,
          false
        ).then((success) => {
          if (success) {
            this.state = {
              ...this.state,
              trimStart: adjustedTrimStart,
              trimEnd: adjustedTrimEnd,
            };
            this.renderTrimmer();
          }
        });
      }
    }
    handleDelete() {
      let trimStart: number;
      let trimEnd: number;
      if (this.state.trimStart === null || this.state.trimEnd === null) {
        return;
      }
      if (this.state.trimEnd > this.state.trimStart) {
        trimStart = this.state.trimStart;
        trimEnd = this.state.trimEnd;
      } else {
        trimStart = this.state.trimEnd;
        trimEnd = this.state.trimStart;
      }
      const { samples, sampleRate } = this.copyCurrentBuffer();
      const sampleCount = samples.length;
      const startIndex = Math.floor(trimStart * sampleCount);
      const endIndex = Math.floor(trimEnd * sampleCount);
      const firstPart = samples.slice(0, startIndex);
      const secondPart = samples.slice(endIndex, sampleCount);
      const newLength = firstPart.length + secondPart.length;
      let newSamples: Float32Array;
      if (newLength === 0) {
        newSamples = new Float32Array(1);
      } else {
        newSamples = new Float32Array(newLength);
        newSamples.set(firstPart, 0);
        newSamples.set(secondPart, firstPart.length);
      }
      this.submitNewSamples(newSamples, sampleRate).then(() => {
        this.state = {
          ...this.state,
          trimStart: null,
          trimEnd: null,
        };
        document.getElementById("trimmer")!.style.opacity = "0";
      });
    }
    resampleBufferToRate (buffer: { samples: Float32Array, sampleRate: number}, newRate: number) {
      return new Promise((resolve: (arg: { samples: Float32Array, sampleRate: number}) => void, reject) => {
          const sampleRateRatio = newRate / buffer.sampleRate;
          const newLength = sampleRateRatio * buffer.samples.length;
          let offlineContext: OfflineAudioContext | undefined;
          // Try to use either OfflineAudioContext or webkitOfflineAudioContext to resample
          // The constructors will throw if trying to resample at an unsupported rate
          // (e.g. Safari/webkitOAC does not support lower than 44khz).
          try {
              if (window.OfflineAudioContext) {
                  offlineContext = new window.OfflineAudioContext(1, newLength, newRate);
                  // @ts-expect-error
              } else if (window.webkitOfflineAudioContext) {
                  // @ts-expect-error
                  offlineContext = new window.webkitOfflineAudioContext(1, newLength, newRate);
              }
          } catch {
              // If no OAC available and downsampling by 2, downsample by dropping every other sample.
              if (newRate === buffer.sampleRate / 2) {
                  return resolve(dropEveryOtherSample(buffer));
              }
              return reject(new Error('Could not resample'));
          }
          const source = offlineContext!.createBufferSource();
          const audioBuffer = offlineContext!.createBuffer(1, buffer.samples.length, buffer.sampleRate);
          audioBuffer.getChannelData(0).set(buffer.samples);
          source.buffer = audioBuffer;
          source.connect(offlineContext!.destination);
          source.start();
          offlineContext!.startRendering().then((renderedBuffer) => {
              resolve({
                  samples: renderedBuffer.getChannelData(0),
                  sampleRate: newRate
              });
          });
      });
    }
    onPlayButtonClick() {
      if (this.state.playHead !== null) {
        this.audioBufferPlayer!.stop();
        this.state = {
          ...this.state,
          playHead: null,
        };
      } else {
        this.handlePlay();
      }
    }
    renderPlayButton() {
      if (this.state.playHead !== null) {
        document
          .querySelector(".play-button > img")
          ?.setAttribute("src", this.metadata.stop);
      } else {
        document
          .querySelector(".play-button > img")
          ?.setAttribute("src", this.metadata.play);
      }
      window.requestAnimationFrame(this.renderPlayButton.bind(this));
    }
    onContainerMouseDown() {
      if (this.state.trimStart === null) {
        this.containerState.isMouseDown = true;
      } else {
        this.state = {
          ...this.state,
          trimStart: null,
          trimEnd: null,
        };
        document.getElementById("trimmer")!.style.opacity = "0";
      }
    }
    onContainerMouseUp() {
      this.containerState.isMouseDown = false;
      this.containerState.isTrimStartRecognized = false;
    }
    onContainerMouseMove(e: MouseEvent) {
      if (!this.containerState.isMouseDown) {
        return;
      }
      const _width =
        e.offsetX / (e.target as HTMLElement).getBoundingClientRect().width;
      if (!this.containerState.isTrimStartRecognized) {
        this.state = {
          ...this.state,
          trimStart: _width > 0.0 ? _width : 0.0,
          trimEnd: _width > 0.0 ? _width : 0.0,
        };
        this.containerState.isTrimStartRecognized = true;
        this.renderTrimmer();
      } else {
        this.state = {
          ...this.state,
          trimEnd: _width > 0.0 ? _width : 0.0,
        };
        this.renderTrimmer();
      }
    }
    renderTrimmer() {
      if (
        (this.state.trimEnd! > this.state.trimStart!
          ? this.state.trimStart! * 100
          : this.state.trimEnd! * 100) < 0
      ) {
        return;
      }
      if (Math.abs(this.state.trimEnd! - this.state.trimStart!) * 100 > 100) {
        return;
      }
      document.getElementById("trimmer")!.style.width = `${
        Math.abs(this.state.trimEnd! - this.state.trimStart!) * 100
      }%`;
      document.getElementById("trimmer")!.style.left = `${
        this.state.trimEnd! > this.state.trimStart!
          ? this.state.trimStart! * 100
          : this.state.trimEnd! * 100
      }%`;
      document.getElementById("trimmer")!.style.opacity = "1";
      document.getElementById("left-handle")!.style.opacity = "1";
      document.getElementById("right-handle")!.style.opacity = "1";
    }
  }
  const editor = new SoundEditorClient();
  window.addEventListener("message", async (e) => {
    const { type, body, requestId } = e.data;
    switch (type) {
      case "init": {
        editor.init(body.value);
        editor.renderPlayButton();
        editor.ext = body.path;
      }
      case "update": {
        if (typeof body.edits === "undefined" || body?.length === 0) {
          return;
        }
        console.log(body.edits);
        editor.update(body.edits[body.edits.length - 1]);
      }
      case "getFileData": {
        editor.getAudioData().then((buffer) => {
          vscode.postMessage({
            type: "response",
            requestId,
            body: Array.from(buffer),
          });
        });
      }
    }
  });
  document
    .getElementById("fade-in-effect")!
    .addEventListener("click", () =>
      editor.effectFactory(AudioEffects.effectTypes.FADEIN)()
    );
  document
    .getElementById("fade-out-effect")!
    .addEventListener("click", () =>
      editor.effectFactory(AudioEffects.effectTypes.FADEOUT)()
    );
  document
    .getElementById("mute-effect")!
    .addEventListener("click", () =>
      editor.effectFactory(AudioEffects.effectTypes.MUTE)()
    );
  document
    .getElementById("softer-effect")!
    .addEventListener("click", () =>
      editor.effectFactory(AudioEffects.effectTypes.SOFTER)()
    );
  document
    .getElementById("louder-effect")!
    .addEventListener("click", () =>
      editor.effectFactory(AudioEffects.effectTypes.LOUDER)()
    );
  document
    .getElementById("faster-effect")!
    .addEventListener("click", () =>
      editor.effectFactory(AudioEffects.effectTypes.FASTER)()
    );
  document
    .getElementById("slower-effect")!
    .addEventListener("click", () =>
      editor.effectFactory(AudioEffects.effectTypes.SLOWER)()
    );
  document
    .getElementById("echo-effect")!
    .addEventListener("click", () =>
      editor.effectFactory(AudioEffects.effectTypes.ECHO)()
    );
  document
    .getElementById("reverse-effect")!
    .addEventListener("click", () =>
      editor.effectFactory(AudioEffects.effectTypes.REVERSE)()
    );
  document
    .getElementById("robot-effect")!
    .addEventListener("click", () =>
      editor.effectFactory(AudioEffects.effectTypes.ROBOT)()
    );
  document
    .getElementById("control-top-zone")!
    .addEventListener("mousedown", () => editor.onContainerMouseDown());
  document
    .getElementById("control-top-zone")!
    .addEventListener("mouseup", () => editor.onContainerMouseUp());
  document
    .getElementById("control-top-zone")!
    .addEventListener("mousemove", (e) =>
      editor.onContainerMouseMove(e as MouseEvent)
    );
  document
    .getElementsByClassName("play-button")[0]
    .addEventListener("click", () => editor.onPlayButtonClick());
  document
    .getElementById("copy-button")!
    .addEventListener("click", () => editor.handleCopy());
  document
    .getElementById("paste-button")!
    .addEventListener("click", () => editor.handlePaste());
  document
    .getElementById("delete-button")!
    .addEventListener("click", () => editor.handleDelete());
  vscode.postMessage({ type: "ready" });
})();
