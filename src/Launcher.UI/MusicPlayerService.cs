using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Threading;
using Launcher.Services;
using MediaPlayer = System.Windows.Media.MediaPlayer;

namespace Launcher.UI;

/// <summary>
/// Plays the launcher's background music. The track is a soft, always-offline
/// ambient piece rendered on the fly with code (no bundled audio asset): a warm
/// Am–F–C–G progression played by chord pads, a half-note bass line, a gentle
/// one-octave arpeggio, a subtle bell shimmer and a soft echo, looped seamlessly.
/// Listens to <see cref="SettingsService.BackgroundMusic"/> and
/// <see cref="SettingsService.MusicVolume"/> and reacts live.
/// Lives in the UI assembly because playback uses WPF's <see cref="MediaPlayer"/>.
/// </summary>
public sealed class MusicPlayerService : IDisposable
{
    private static byte[]? _wavCache;

    private readonly SettingsService _settings;
    private readonly Dispatcher _dispatcher;
    private readonly MediaPlayer _player = new();
    private string? _wavPath;
    private bool _playing;
    private bool _disposed;

    public MusicPlayerService(SettingsService settings)
    {
        _settings = settings;
        _dispatcher = Application.Current.Dispatcher;
        _player.MediaEnded += OnMediaEnded;
        _settings.PropertyChanged += OnSettingsChanged;
        if (_settings.BackgroundMusic) Start();
    }

    /// <summary>Starts (or resumes) the ambient loop.</summary>
    public void Start()
    {
        if (_playing || _disposed) return;
        _playing = true;
        try
        {
            _wavCache ??= BuildLoopWave();
            _wavPath ??= WriteTempWave(_wavCache);
            _player.Volume = Math.Clamp(_settings.MusicVolume / 100d, 0, 1);
            _player.Open(new Uri(_wavPath));
            _player.Play();
        }
        catch
        {
            _playing = false; // audio is best-effort and must never crash the UI
        }
    }

    /// <summary>Stops the loop (volume stays where the user left it).</summary>
    public void Stop()
    {
        if (!_playing) return;
        _playing = false;
        try
        {
            _player.Pause();
            _player.Close();
        }
        catch { /* best-effort */ }
    }

    private void OnSettingsChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(SettingsService.BackgroundMusic):
                if (_settings.BackgroundMusic) Start();
                else Stop();
                break;
            case nameof(SettingsService.MusicVolume):
                if (!_disposed)
                    _player.Volume = Math.Clamp(_settings.MusicVolume / 100d, 0, 1);
                break;
        }
    }

    private void OnMediaEnded(object? sender, EventArgs e)
    {
        if (!_playing) return;
        if (!_dispatcher.CheckAccess())
        {
            _dispatcher.BeginInvoke(new Action(RestartLoop));
            return;
        }
        RestartLoop();
    }

    private void RestartLoop()
    {
        if (!_playing) return;
        _player.Position = TimeSpan.Zero;
        _player.Play();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _settings.PropertyChanged -= OnSettingsChanged;
        _player.MediaEnded -= OnMediaEnded;
        try { _player.Stop(); _player.Close(); } catch { /* best-effort */ }
        try
        {
            if (_wavPath is not null && File.Exists(_wavPath)) File.Delete(_wavPath);
        }
        catch { /* best-effort */ }
    }

    private static string WriteTempWave(byte[] wav)
    {
        var path = Path.Combine(Path.GetTempPath(), $"foxlauncher-bgm-{Process.GetCurrentProcess().Id}.wav");
        File.WriteAllBytes(path, wav);
        return path;
    }

    // ------------------------------------------------------------------ synth

    /// <summary>
    /// Renders the background music as a 16-bit PCM mono WAV (~27 s, loopable).
    /// Composition, 70 BPM, key of A minor:
    ///   • chord pads      Am7 → Fmaj7 → Cmaj9 → G add9, 2 bars each
    ///   • half-note bass  root → fifth per chord
    ///   • soft arpeggio   chord tones one octave up, eighth-note pulse
    ///   • bell shimmer    high sparkle on the second half
    ///   • gentle no-feedback echo, tail folded back so the loop is seamless
    /// </summary>
    private static byte[] BuildLoopWave()
    {
        const int sampleRate = 44100;
        const double beat = 60.0 / 70.0;          // 70 BPM
        const double bar = 4.0 * beat;
        const int chords = 4, barsPerChord = 2;
        int loop = (int)(chords * barsPerChord * bar * sampleRate);

        // Am7 | Fmaj7 | Cmaj9 | G add9 (equal temperament, A4 = 440 Hz)
        double[][] chordVoicings =
        {
            new[] { 220.00, 261.63, 329.63, 392.00 },
            new[] { 174.61, 220.00, 261.63, 329.63 },
            new[] { 130.81, 164.81, 196.00, 293.66 },
            new[] { 196.00, 246.94, 293.66, 440.00 }
        };
        // bass: root → fifth, one half-note each
        double[][] bassLines =
        {
            new[] { 110.00, 164.81 },
            new[] {  87.31, 130.81 },
            new[] { 130.81, 196.00 },
            new[] {  98.00, 146.83 }
        };
        var arpPattern = new[] { 0, 1, 2, 3, 2, 1, 3, 2 };

        // Extra headroom for the echo tail; folded back into the loop below.
        int tail = (int)(1.6 * sampleRate);
        var render = new float[loop + tail];

        for (int c = 0; c < chords; c++)
        {
            double start = c * barsPerChord * bar;
            AddPad(render, sampleRate, start, barsPerChord * bar,
                   chordVoicings[c], amp: 0.30);
            AddBass(render, sampleRate, start, beatsPerNote: 4.0, bassLines[c]);
            AddArp(render, sampleRate, start, barsPerChord * bar,
                   arpPattern, chordVoicings[c], amp: 0.15);
            if (c >= 2) // second half: a high sparkle so the loop has a lift
                AddBell(render, sampleRate, start, dur: 2.5,
                        chordVoicings[c][0] * 4.0, amp: 0.07);
        }

        // Soft echo (no feedback, always decays).
        int delaySamples = (int)(0.375 * sampleRate);
        for (int i = delaySamples; i < render.Length; i++)
            render[i] += 0.18f * render[i - delaySamples];

        // Fold the echo tail back so the loop boundary is perfectly seamless.
        var looped = new float[loop];
        Array.Copy(render, looped, loop);
        for (int i = 0; i < tail; i++) looped[i] += render[loop + i];

        // Normalize to a healthy peak so the volume slider stays meaningful.
        double peak = 0;
        foreach (var s in looped) peak = Math.Max(peak, Math.Abs(s));
        if (peak > 0)
        {
            double scale = 0.8 / peak;
            for (int i = 0; i < looped.Length; i++) looped[i] = (float)(looped[i] * scale);
        }

        var pcm = new byte[44 + loop * 2];
        WriteWavHeader(pcm, sampleRate, 1, 16, loop);
        for (int i = 0; i < loop; i++)
        {
            short v = (short)Math.Round(Math.Clamp(looped[i], -1, 1) * short.MaxValue);
            int o = 44 + i * 2;
            pcm[o] = (byte)(v & 0xFF);
            pcm[o + 1] = (byte)((v >> 8) & 0xFF);
        }
        return pcm;
    }

    /// <summary>Two lightly detuned partials per note give the pads a warm,
    /// slowly beating body without harsh upper harmonics.</summary>
    private static void AddPad(float[] buf, int sr, double start, double dur, double[] freqs, double amp)
    {
        int s0 = (int)(sr * start);
        int n = (int)(sr * dur);
        for (int i = 0; i < n; i++)
        {
            double t = i / (double)sr;
            double env = Envelope(t, dur, attack: 0.45, release: 0.9);
            if (env <= 0.001) continue;
            double v = 0;
            foreach (double f in freqs)
            {
                double w = 2 * Math.PI * f;
                v += Math.Sin(w * t) + 0.45 * Math.Sin(w * 1.003 * t);
            }
            int idx = s0 + i;
            if (idx < buf.Length) buf[idx] += (float)(v * env * amp / freqs.Length);
        }
    }

    /// <summary>Root → fifth half-notes as a near-sine, so the low end is felt
    /// rather than heard.</summary>
    private static void AddBass(float[] buf, int sr, double start, double beatsPerNote, double[] notes)
    {
        const double beat = 60.0 / 70.0;
        for (int k = 0; k < notes.Length; k++)
        {
            double dur = beatsPerNote * beat;
            int s0 = (int)(sr * (start + k * dur));
            int n = (int)(sr * dur);
            double w = 2 * Math.PI * notes[k];
            for (int i = 0; i < n; i++)
            {
                double t = i / (double)sr;
                double env = Math.Min(t / 0.03, 1) * Math.Min((dur - t) / 0.15, 1);
                if (env <= 0.001) continue;
                double v = Math.Sin(w * t) + 0.15 * Math.Sin(2 * w * t);
                int idx = s0 + i;
                if (idx < buf.Length) buf[idx] += (float)(v * env * 0.34);
            }
        }
    }

    /// <summary>Soft plucks, an octave up, cycling the chord tones in 8th notes —
    /// adds motion without demanding attention.</summary>
    private static void AddArp(float[] buf, int sr, double start, double dur, int[] pattern, double[] freqs, double amp)
    {
        const double noteBeats = 0.5;              // 8th note
        double beat = 60.0 / 70.0;
        double noteSec = noteBeats * beat;
        int slots = (int)(dur / noteSec);
        for (int k = 0; k < slots; k++)
        {
            double f = freqs[pattern[k % pattern.Length]] * 2;
            int s0 = (int)(sr * (start + k * noteSec));
            int n = Math.Min((int)(sr * noteSec), buf.Length - s0);
            double w = 2 * Math.PI * f;
            for (int i = 0; i < n; i++)
            {
                double t = i / (double)sr;
                double env = Math.Min(t / 0.004, 1) * Math.Exp(-7.0 * t);
                double v = Math.Sin(w * t) + 0.25 * Math.Sin(2 * w * t);
                buf[s0 + i] += (float)(v * env * amp);
            }
        }
    }

    /// <summary>High, bell-like single note (root two octaves up) with a long
    /// decay, for a gentle sparkling lift.</summary>
    private static void AddBell(float[] buf, int sr, double start, double dur, double f, double amp)
    {
        int s0 = (int)(sr * start);
        int n = Math.Min((int)(sr * dur), buf.Length - s0);
        double w = 2 * Math.PI * f;
        for (int i = 0; i < n; i++)
        {
            double t = i / (double)sr;
            double env = Math.Min(t / 0.002, 1) * Math.Exp(-3.2 * t);
            double v = Math.Sin(w * t) + 0.45 * Math.Sin(3 * w * t);
            buf[s0 + i] += (float)(v * env * amp);
        }
    }

    private static double Envelope(double t, double dur, double attack, double release)
    {
        if (t >= dur) return 0;
        double a = Math.Min(t / attack, 1.0);
        double r = Math.Min((dur - t) / release, 1.0);
        return Math.Max(a, 0) * Math.Max(r, 0);
    }

    private static void WriteWavHeader(byte[] data, int sampleRate, short channels, short bits, int totalSamples)
    {
        int dataLen = totalSamples * channels * (bits / 8);
        using var writer = new BinaryWriter(new MemoryStream(data));
        writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));
        writer.Write(36 + dataLen);
        writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVE"));
        writer.Write(System.Text.Encoding.ASCII.GetBytes("fmt "));
        writer.Write(16);
        writer.Write((short)1);
        writer.Write(channels);
        writer.Write(sampleRate);
        writer.Write(sampleRate * channels * (bits / 8));
        writer.Write((short)(channels * (bits / 8)));
        writer.Write(bits);
        writer.Write(System.Text.Encoding.ASCII.GetBytes("data"));
        writer.Write(dataLen);
    }
}