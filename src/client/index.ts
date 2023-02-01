/// <reference lib="dom" />
/// <reference path="./../types.d.ts" />
import AudioBufferPlayer from "./audio-buffer-player";
import AudioEffects from "./audio-effects";
import { analyze } from "./peak-analyzer";
import { computeChunkedRMS } from "./utils/audio-utils";
import * as WavEncoder from "./wav-encoder";
const MIN_LENGTH = 0.01;
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
      chunkLevels: null | number[],
      isTrimmerMouseDown: boolean;
    };
    constructor() {
      this.context = new AudioContext();
      this.audioBufferPlayer = null;
      this.state = {
        trimStart: null,
        trimEnd: null,
        playHead: null,
        chunkLevels: null,
        isTrimmerMouseDown: false,
      };
    }
    get metadata () {
      return JSON.parse(document.getElementById("metadata")!.innerText);
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
        analyze(this.state.chunkLevels!, (document.getElementById("draw-path") as any));
      });
    }
    update(data: any) {
      if (typeof data.channel === "undefined") {
        return;
      }
      const newBuffer = this.context.createBuffer(1, data.channel.length, this.audioBufferPlayer!.buffer.sampleRate);
      newBuffer.getChannelData(0).set(data.channel);
      this.audioBufferPlayer!.buffer = newBuffer;
      //  .getChannelData(0)
      //  .set(new Float32Array(data.channel));
        this.state = {
          ...this.state,
          chunkLevels: computeChunkedRMS(this.audioBufferPlayer!.buffer.getChannelData(0)),
        };
      analyze(this.state.chunkLevels!, (document.getElementById("draw-path") as any));
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
      document.getElementById("play-head")!.style.left = `${100 * this.state.playHead!}%`;
      document.getElementById("play-head")!.style.opacity = "1";
    }
    handleStoppedPlaying() {
      this.state = {
        ...this.state,
        playHead: null,
      };
      document.getElementById("play-head")!.style.opacity = "0";
      console.log("stopped");
    }
    handleStopPlaying() {
      this.audioBufferPlayer!.stop();
      this.handleStoppedPlaying();
    }
    getAudioData() {
      return new Promise((resolve: (buffer: Uint8Array) => void) => {
        WavEncoder.encode({
          sampleRate: this.audioBufferPlayer!.buffer.sampleRate,
          channelData: [this.audioBufferPlayer!.buffer.getChannelData(0)],
        }).then((buffer: ArrayBuffer) => {
          resolve(new Uint8Array(buffer));
        });
      });
    }
    submitNewSamples(
      samples: Float32Array,
      sampleRate: number,
      skipUndo?: boolean
    ) {
      skipUndo = typeof skipUndo === "undefined" ? false : skipUndo;
      return new Promise((resolve) => {
        if (skipUndo === false) {
          // Bugzilla Error: client.js:819 Uncaught (in promise) RangeError: offset is out of bounds;
          // @see https://bugzilla.mozilla.org/show_bug.cgi?id=1245495
          // this.audioBufferPlayer!.buffer.getChannelData(0).set(samples);
          const newBuffer = this.context.createBuffer(1, samples.length, sampleRate);
          newBuffer.getChannelData(0).set(samples);
          this.audioBufferPlayer!.buffer = newBuffer;
          vscode.postMessage({
            type: "audio",
            channel: Array.from(samples),
          });
          this.state = {
            ...this.state,
            chunkLevels: computeChunkedRMS(this.audioBufferPlayer!.buffer.getChannelData(0)),
          };
          analyze(this.state.chunkLevels!, (document.getElementById("draw-path") as any));
        }
        resolve(true);
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
        trimStart,
        trimEnd
      );
      effects.process((renderedBuffer, adjustedTrimStart, adjustedTrimEnd) => {
        const samples = renderedBuffer.getChannelData(0);
        const sampleRate = renderedBuffer.sampleRate;
        this.submitNewSamples(samples, sampleRate).then((success) => {
          if (success) {
            if (this.state.trimStart === null) {
              this.handlePlay();
            } else {
              (this.state = {
                ...this.state,
                trimStart: adjustedTrimStart,
                trimEnd: adjustedTrimEnd,
              }),
                this.handlePlay();
            }
          }
        });
      });
    }
    effectFactory(name: ValueOf<typeof AudioEffects.effectTypes>) {
      return () => this.handleEffect(name);
    }
    onPlayButtonClick () {
      if (this.state.playHead !== null) {
        this.audioBufferPlayer!.stop();
        this.state = {
          ...this.state,
          playHead: null
        };
      } else {
        this.handlePlay();
      }
    }
    renderPlayButton () {
      if (this.state.playHead !== null) {
        document.querySelector(".play-button > img")?.setAttribute("src", this.metadata.stop);
      } else {
        document.querySelector(".play-button > img")?.setAttribute("src", this.metadata.play);
      }
      window.requestAnimationFrame(this.renderPlayButton.bind(this));
    }
  }
  const editor = new SoundEditorClient();
  window.addEventListener("message", async (e) => {
    const { type, body, requestId } = e.data;
    switch (type) {
      case "init": {
        editor.init(body.value);
        editor.renderPlayButton();
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
  document.getElementById("fade-in-effect")!.addEventListener("click", () => editor.effectFactory(AudioEffects.effectTypes.FADEIN)());
  document.getElementById("fade-out-effect")!.addEventListener("click", () => editor.effectFactory(AudioEffects.effectTypes.FADEOUT)());
  document.getElementById("mute-effect")!.addEventListener("click", () => editor.effectFactory(AudioEffects.effectTypes.MUTE)());
  document.getElementById("softer-effect")!.addEventListener("click",() => editor.effectFactory(AudioEffects.effectTypes.SOFTER)());
  document.getElementById("louder-effect")!.addEventListener("click", () => editor.effectFactory(AudioEffects.effectTypes.LOUDER)());
  document.getElementById("faster-effect")!.addEventListener("click", () => editor.effectFactory(AudioEffects.effectTypes.FASTER)());
  document.getElementById("slower-effect")!.addEventListener("click", () => editor.effectFactory(AudioEffects.effectTypes.SLOWER)());
  document.getElementById("echo-effect")!.addEventListener("click", () => editor.effectFactory(AudioEffects.effectTypes.ECHO)());
  document.getElementById("reverse-effect")!.addEventListener("click", () => editor.effectFactory(AudioEffects.effectTypes.REVERSE)());
  document.getElementById("robot-effect")!.addEventListener("click", () => editor.effectFactory(AudioEffects.effectTypes.ROBOT)());
  document.getElementsByClassName("play-button")[0].addEventListener("click", () => editor.onPlayButtonClick());
  vscode.postMessage({ type: "ready" });
})();
