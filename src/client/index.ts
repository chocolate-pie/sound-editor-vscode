/// <reference lib="dom" />
/// <reference path="./../types.d.ts" />
import AudioBufferPlayer from "./audio-buffer-player";
import AudioEffects from "./audio-effects";
import * as WavEncoder from "./wav-encoder";

type ValueOf<T> = T[keyof T];
(() => {
  const vscode = acquireVsCodeApi();
  class SoundEditorClient {
    private context: AudioContext;
    private audioBufferPlayer: null | AudioBufferPlayer;
    private state: {
        trimStart: number | null,
        trimEnd: number | null,
        playHead: number | null
    };
    constructor () {
        this.context = new AudioContext();
        this.audioBufferPlayer = null;
        this.state = {
            trimStart: null,
            trimEnd: null,
            playHead: null
        };
    }
    init (initAudioData: Uint8Array) {
        this.context.decodeAudioData(initAudioData.buffer).then((buffer) => {
            this.audioBufferPlayer = new AudioBufferPlayer(buffer.getChannelData(0), buffer.sampleRate);
            console.log("📢 INFO:", "Initial Audio");
        });
    }
    update (data: any) {
        this.audioBufferPlayer?.buffer.getChannelData(0).set(new Float32Array(data.channel));
        console.log("📢 INFO:", "Update AudioBuffer");
    }
    handlePlay () {
        this.audioBufferPlayer!.stop();
        this.audioBufferPlayer!.play(
            this.state.trimStart || 0,
            this.state.trimEnd || 1,
            this.handleUpdatePlayHead.bind(this),
            this.handleStoppedPlaying.bind(this)
        );
    }
    handleUpdatePlayHead (playHead: number) {
        this.state = {
            ...this.state,
            playHead
        };
    }
    handleStoppedPlaying () {
        this.state = {
            ...this.state,
            playHead: null
        };
        console.log("📢 INFO:", "Sound is Stopped");
    }
    handleStopPlaying () {
        this.audioBufferPlayer!.stop();
        this.handleStoppedPlaying();
    }
    getAudioData () {
        return new Promise((resolve: (buffer: Uint8Array) => void) => {
        WavEncoder.encode({
            sampleRate: this.audioBufferPlayer!.buffer.sampleRate,
            channelData: [this.audioBufferPlayer!.buffer.getChannelData(0)]
        }).then((buffer: ArrayBuffer) => {
            console.log("📢 INFO:", "Audio Data resolved");
            resolve(new Uint8Array(buffer));
        });
        });
    }
    submitNewSamples (samples: Float32Array, sampleRate: number, skipUndo?: boolean) {
        skipUndo = typeof skipUndo === "undefined" ? false : skipUndo;
        return new Promise((resolve) => {
                if (skipUndo === false) {
                    this.audioBufferPlayer!.buffer.getChannelData(0).set(samples);
                    vscode.postMessage({
                        type: "audio",
                        channel: Array.from(samples)
                    });
                }
                resolve(true);
        });
    }
    handleEffect (name: ValueOf<typeof AudioEffects.effectTypes>) {
        const trimStart = this.state.trimStart === null ? 0.0 : this.state.trimStart;
        const trimEnd = this.state.trimEnd === null ? 1.0 : this.state.trimEnd;

        // Offline audio context needs at least 2 samples
        if (this.audioBufferPlayer!.buffer.length < 2) {
            return;
        }
        console.log("[DEBUG] Effect Started");
        console.log(this.audioBufferPlayer!.buffer);
        const effects = new AudioEffects(this.audioBufferPlayer!.buffer, name, trimStart, trimEnd);
        effects.process((renderedBuffer, adjustedTrimStart, adjustedTrimEnd) => {
            console.log("[DEBUG] Effect Finished");
            const samples = renderedBuffer.getChannelData(0);
            const sampleRate = renderedBuffer.sampleRate;
            this.submitNewSamples(samples, sampleRate).then(success => {
                console.log(this.audioBufferPlayer!.buffer);
                if (success) {
                    if (this.state.trimStart === null) {
                        this.handlePlay();
                    } else {
                        this.state = {
                            ...this.state,
                            trimStart: adjustedTrimStart,
                            trimEnd: adjustedTrimEnd
                        }, 
                        this.handlePlay();
                    }
                }
            });
        });
    }
    effectFactory (name: ValueOf<typeof AudioEffects.effectTypes>) {
        return () => this.handleEffect(name);
    }
  }
  const editor = new SoundEditorClient();
  window.addEventListener('message', async (e) => {
    const { type, body, requestId } = e.data;
    switch (type) {
        case "init": {
            editor.init(body.value);
        };
        case "update": {
            if(typeof body.edits === "undefined") {
                return;
            }
            console.log(body.edits);
            editor.update(body.edits[body.edits.length - 1]);
        };
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
  document.getElementById('fade-effect')!.addEventListener('click', () => {
    editor.effectFactory(AudioEffects.effectTypes.FADEOUT)();
  });
  vscode.postMessage({ type: 'ready' });
})();