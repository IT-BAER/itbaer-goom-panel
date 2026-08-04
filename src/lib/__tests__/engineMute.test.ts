import { isEngineMuted, resumeEngineAudio, setEngineMuted } from '../engine';

describe('engine mute', () => {
  const node = { connect: jest.fn(), disconnect: jest.fn() };
  const ctx = { state: 'running', destination: {}, resume: jest.fn(), suspend: jest.fn() };

  beforeEach(() => {
    node.connect.mockReset();
    node.disconnect.mockReset();
    (window as unknown as { Module: unknown }).Module = {
      SDL2: { audioContext: ctx, audio: { scriptProcessorNode: node } },
    };
    setEngineMuted(false);
    node.connect.mockClear();
    node.disconnect.mockClear();
  });

  it('mutes by cutting the output node, not by suspending the context', () => {
    setEngineMuted(true);

    expect(node.disconnect).toHaveBeenCalled();
    // Suspending is what Emscripten's autoResumeAudioContext undoes on keypress.
    expect(ctx.suspend).not.toHaveBeenCalled();
    expect(isEngineMuted()).toBe(true);
  });

  it('stays muted when a keypress or click triggers a gesture resume', () => {
    setEngineMuted(true);
    node.connect.mockClear();

    resumeEngineAudio();

    expect(node.connect).not.toHaveBeenCalled();
    expect(isEngineMuted()).toBe(true);
  });

  it('reconnects the output node on unmute', () => {
    setEngineMuted(true);
    setEngineMuted(false);

    expect(node.connect).toHaveBeenCalledWith(ctx.destination);
  });
});
