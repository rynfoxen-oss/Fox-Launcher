using System.Globalization;
using System.IO;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Launcher.Skin;

namespace Launcher.Views.Controls;

/// <summary>
/// A clean TLauncher-style 2D Minecraft skin preview. Composes the character's
/// front view (head + hat, body + jacket, arms + sleeves, legs + pants) from the
/// skin atlas into a device-resolution bitmap, so every texture pixel maps to an
/// exact crisp device pixel (nearest-neighbour, no blur) at any DPI. Supports
/// Steve and Alex, 64x64 and 128x128 skins and full transparency, and shows a
/// soft floor shadow with an optional subtle idle bob.
/// </summary>
public sealed partial class Skin2DPreview : UserControl
{
    /// <summary>Bundled fallback skin used when no texture is provided.</summary>
    private const string DefaultSkinResource = "pack://application:,,,/Launcher.Views;component/Assets/skins/default_steve.png";

    private const int TopPadUnits = 3;     // breathing room above the head
    private const int BottomPadUnits = 3;  // gap between feet and shadow
    private const int SidePadUnits = 2;
    private const int FigureUnits = 32;

    private readonly CancellationTokenSource _cts = new();
    private SkinCache? _cache;
    private volatile bool _dirty = true;
    private DispatcherTimer? _timer;
    private long _lastRender;

    public Skin2DPreview()
    {
        InitializeComponent();
        Loaded += (_, _) => { Render(); StartBob(); };
        Unloaded += (_, _) => StopBob();
        SizeChanged += (_, _) => { _dirty = true; Render(); };
    }

    protected override void OnDpiChanged(DpiScale oldDpi, DpiScale newDpi)
    {
        base.OnDpiChanged(oldDpi, newDpi);
        _dirty = true;
        Render();
    }

    public static readonly DependencyProperty TextureUrlProperty =
        DependencyProperty.Register(nameof(TextureUrl), typeof(string), typeof(Skin2DPreview),
            new PropertyMetadata("", (d, _) => ((Skin2DPreview)d).Render()));

    public string TextureUrl
    {
        get => (string)GetValue(TextureUrlProperty);
        set => SetValue(TextureUrlProperty, value);
    }

    /// <summary>"Auto", "Classic" or "Slim" (Auto uses the account variant, then
    /// falls back to pixel detection).</summary>
    public static readonly DependencyProperty ModelPreferenceProperty =
        DependencyProperty.Register(nameof(ModelPreference), typeof(string), typeof(Skin2DPreview),
            new PropertyMetadata("Auto", (d, _) => ((Skin2DPreview)d).Render()));

    public string ModelPreference
    {
        get => (string)GetValue(ModelPreferenceProperty);
        set => SetValue(ModelPreferenceProperty, value);
    }

    /// <summary>Variant declared by the account: "CLASSIC", "SLIM" or empty.</summary>
    public static readonly DependencyProperty SkinVariantProperty =
        DependencyProperty.Register(nameof(SkinVariant), typeof(string), typeof(Skin2DPreview),
            new PropertyMetadata("", (d, _) => ((Skin2DPreview)d).Render()));

    public string SkinVariant
    {
        get => (string)GetValue(SkinVariantProperty);
        set => SetValue(SkinVariantProperty, value);
    }

    /// <summary>Whether the subtle idle bob runs. Off by default (static preview).</summary>
    public static readonly DependencyProperty AnimationEnabledProperty =
        DependencyProperty.Register(nameof(AnimationEnabled), typeof(bool), typeof(Skin2DPreview),
            new PropertyMetadata(false, (d, _) =>
            {
                var c = (Skin2DPreview)d;
                if (c.AnimationEnabled) c.StartBob(); else c.StopBob();
            }));

    public bool AnimationEnabled
    {
        get => (bool)GetValue(AnimationEnabledProperty);
        set => SetValue(AnimationEnabledProperty, value);
    }

    /// <summary>Accepted for binding compatibility with the 3D viewer; 2D output
    /// is always crisp so this has no effect.</summary>
    public static readonly DependencyProperty RenderQualityProperty =
        DependencyProperty.Register(nameof(RenderQuality), typeof(string), typeof(Skin2DPreview),
            new PropertyMetadata("Medium"));

    public string RenderQuality
    {
        get => (string)GetValue(RenderQualityProperty);
        set => SetValue(RenderQualityProperty, value);
    }

    // ------------------------------------------------------------------ loading

    private async void Render()
    {
        if (!IsLoaded || !_dirty) return;
        _dirty = false;

        var requested = TextureUrl;
        var url = string.IsNullOrWhiteSpace(requested) ? DefaultSkinResource : requested;
        var token = _cts.Token;

        try
        {
            var bytes = await LoadBytesAsync(url, token).ConfigureAwait(true);
            if (token.IsCancellationRequested || bytes is null) return;
            var tex = PngDecoder.Decode(bytes);

            bool isDefault = string.Equals(url, DefaultSkinResource, StringComparison.Ordinal);
            if (tex is null && !isDefault)
            {
                var fb = await LoadBytesAsync(DefaultSkinResource, token).ConfigureAwait(true);
                if (token.IsCancellationRequested) return;
                tex = fb is null ? null : PngDecoder.Decode(fb);
                isDefault = true;
            }
            if (token.IsCancellationRequested || tex is null) return;
            if (!string.Equals(TextureUrl, requested, StringComparison.Ordinal)) return;

            var type = ResolveType(tex);
            if (isDefault && type == SkinModelType.Slim)
            {
                // The bundled default is a classic Steve texture; crop it to a
                // slim layout so "Slim / Auto on a slim account" renders an Alex.
                tex = tex.ToSlim();
            }

            BuildFigure(tex, type);
        }
        catch
        {
            // Ignore load failures; the panel simply keeps its previous figure.
        }
    }

    private SkinModelType ResolveType(SkinTexture tex)
    {
        switch (ModelPreference.Trim().ToLowerInvariant())
        {
            case "classic": return SkinModelType.Classic;
            case "slim": return SkinModelType.Slim;
        }
        if (SkinVariant.Equals("SLIM", StringComparison.OrdinalIgnoreCase)) return SkinModelType.Slim;
        if (SkinVariant.Equals("CLASSIC", StringComparison.OrdinalIgnoreCase)) return SkinModelType.Classic;
        return ModelDetector.Detect(tex) ?? SkinModelType.Classic;
    }

    private async Task<byte[]?> LoadBytesAsync(string url, CancellationToken ct)
    {
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            if (uri.Scheme == "file")
            {
                return File.Exists(uri.LocalPath)
                    ? await File.ReadAllBytesAsync(uri.LocalPath, ct).ConfigureAwait(false)
                    : null;
            }
            if (uri.Scheme == "pack")
            {
                try
                {
                    using var stream = Application.GetResourceStream(uri)?.Stream;
                    if (stream is null) return null;
                    using var ms = new MemoryStream();
                    await stream.CopyToAsync(ms, ct).ConfigureAwait(false);
                    return ms.ToArray();
                }
                catch
                {
                    return null;
                }
            }
        }
        if (File.Exists(url))
        {
            return await File.ReadAllBytesAsync(url, ct).ConfigureAwait(false);
        }
        try
        {
            if (_cache is null && AppHost.Services?.Container is { } container)
            {
                var http = container.Resolve<Launcher.Network.Http>();
                _cache = http is null ? null : new SkinCache(http);
            }
            return _cache is null ? null : await _cache.GetAsync(url, ct).ConfigureAwait(false);
        }
        catch
        {
            return null;
        }
    }

    // ------------------------------------------------------------------ figure

    /// <summary>Composes the front view of the character into a device-resolution
    /// bitmap and swaps it onto the Image at a 1:1 device-pixel size.</summary>
    private void BuildFigure(SkinTexture tex, SkinModelType type)
    {
        bool slim = type == SkinModelType.Slim;
        int armW = slim ? 3 : 4;
        var dpi = VisualTreeHelper.GetDpi(this);

        int totalUnitsW = SidePadUnits * 2 + 8 + armW * 2;
        int totalUnitsH = TopPadUnits + FigureUnits + BottomPadUnits;

        // Pick the largest whole-unit scale that still fits inside the host on
        // BOTH axes (in device pixels), so a loaded skin always downscales to
        // fit its box (object-fit: contain) and never overflows or stretches.
        double targetW = Math.Max(1, ActualWidth * dpi.DpiScaleX);
        double targetH = Math.Max(1, ActualHeight * dpi.DpiScaleY);
        int uFromWidth = (int)Math.Floor(targetW / totalUnitsW);
        int uFromHeight = (int)Math.Floor(targetH / totalUnitsH);
        int u = Math.Max(1, Math.Min(64, Math.Min(uFromWidth, uFromHeight)));
        int width = totalUnitsW * u;
        int height = totalUnitsH * u;

        var buf = new byte[width * height * 4]; // straight alpha, cleared

        DrawFace(tex, SkinPart.RightArm, SkinLayer.Base, SkinFace.Front, slim, u, SidePadUnits, TopPadUnits + 8, width, buf);
        DrawFace(tex, SkinPart.LeftArm, SkinLayer.Base, SkinFace.Front, slim, u, SidePadUnits + 8 + armW, TopPadUnits + 8, width, buf);
        DrawFace(tex, SkinPart.RightLeg, SkinLayer.Base, SkinFace.Front, slim, u, SidePadUnits + armW, TopPadUnits + 8 + 12, width, buf);
        DrawFace(tex, SkinPart.LeftLeg, SkinLayer.Base, SkinFace.Front, slim, u, SidePadUnits + armW + 4, TopPadUnits + 8 + 12, width, buf);
        DrawFace(tex, SkinPart.Body, SkinLayer.Base, SkinFace.Front, slim, u, SidePadUnits + armW, TopPadUnits + 8, width, buf);

        DrawFace(tex, SkinPart.Head, SkinLayer.Base, SkinFace.Front, slim, u, SidePadUnits + armW, TopPadUnits, width, buf);
        DrawFace(tex, SkinPart.Head, SkinLayer.Overlay, SkinFace.Front, slim, u, SidePadUnits + armW, TopPadUnits, width, buf);
        DrawFace(tex, SkinPart.LeftArm, SkinLayer.Overlay, SkinFace.Front, slim, u, SidePadUnits + 8 + armW, TopPadUnits + 8, width, buf);
        DrawFace(tex, SkinPart.RightArm, SkinLayer.Overlay, SkinFace.Front, slim, u, SidePadUnits, TopPadUnits + 8, width, buf);
        DrawFace(tex, SkinPart.LeftLeg, SkinLayer.Overlay, SkinFace.Front, slim, u, SidePadUnits + armW + 4, TopPadUnits + 8 + 12, width, buf);
        DrawFace(tex, SkinPart.RightLeg, SkinLayer.Overlay, SkinFace.Front, slim, u, SidePadUnits + armW, TopPadUnits + 8 + 12, width, buf);
        DrawFace(tex, SkinPart.Body, SkinLayer.Overlay, SkinFace.Front, slim, u, SidePadUnits + armW, TopPadUnits + 8, width, buf);

        Premultiply(buf);

        var wb = new WriteableBitmap(width, height, 96, 96, PixelFormats.Pbgra32, null);
        wb.WritePixels(new Int32Rect(0, 0, width, height), buf, width * 4, 0);
        wb.Freeze();

        Figure.Source = wb;
        Figure.Width = width / dpi.DpiScaleX;
        Figure.Height = height / dpi.DpiScaleY;

        double cx = (ActualWidth - Figure.Width) / 2;
        double cy = (ActualHeight - Figure.Height) / 2;
        Canvas.SetLeft(Figure, cx);
        Canvas.SetTop(Figure, cy);
        PlaceShadow(cx, cy, TopPadUnits + FigureUnits, totalUnitsH);
        _lastRender = Environment.TickCount64;
    }

    /// <summary>Blits one front face of the atlas into the destination buffer at
    /// unit scale with straight-alpha source-over compositing.</summary>
    private static void DrawFace(SkinTexture tex, SkinPart part, SkinLayer layer, SkinFace face, bool slim,
        int u, int destXUnits, int destYUnits, int width, byte[] dst)
    {
        var r = SkinUVMapper.GetRegion(part, layer, face, slim, tex.Width);
        for (int row = 0; row < r.H; row++)
        {
            int srcIndex = ((r.V + row) * tex.Width + r.U) * 4;
            for (int col = 0; col < r.W; col++)
            {
                int s = srcIndex + col * 4;
                byte sa = tex.Pixels[s + 3];
                if (sa == 0) continue;

                byte sr = tex.Pixels[s + 2];
                byte sg = tex.Pixels[s + 1];
                byte sb = tex.Pixels[s + 0];

                int dstX = (destXUnits + col) * u;
                int dstY = (destYUnits + row) * u;
                for (int yy = 0; yy < u; yy++)
                {
                    int drow = (dstY + yy) * width;
                    for (int xx = 0; xx < u; xx++)
                    {
                        int d = (drow + dstX + xx) * 4;
                        byte da = dst[d + 3];
                        int ia = 255 - sa;
                        int outA = sa + (da * ia) / 255;
                        if (outA == 0) continue;
                        dst[d] = Clamp((sb * sa + (dst[d] * da * ia) / 255) / outA);
                        dst[d + 1] = Clamp((sg * sa + (dst[d + 1] * da * ia) / 255) / outA);
                        dst[d + 2] = Clamp((sr * sa + (dst[d + 2] * da * ia) / 255) / outA);
                        dst[d + 3] = (byte)outA;
                    }
                }
            }
        }
    }

    private static byte Clamp(int v) => (byte)(v > 255 ? 255 : v);

    /// <summary>Converts straight alpha to premultiplied (Pbgra32) in place.</summary>
    private static void Premultiply(byte[] buf)
    {
        for (int i = 0; i < buf.Length; i += 4)
        {
            int a = buf[i + 3];
            if (a == 0) continue;
            buf[i] = (byte)((buf[i] * a) / 255);
            buf[i + 1] = (byte)((buf[i + 1] * a) / 255);
            buf[i + 2] = (byte)((buf[i + 2] * a) / 255);
        }
    }

    /// <summary>Positions the floor shadow directly under the character's feet.</summary>
    private void PlaceShadow(double cx, double cy, int feetUnits, int totalUnitsH)
    {
        double shW = Figure.Width * 0.95;
        double shH = Figure.Height * 0.16;
        double feetY = cy + (feetUnits / (double)totalUnitsH) * Figure.Height;
        Shadow.Width = shW;
        Shadow.Height = shH;
        Canvas.SetLeft(Shadow, cx + (Figure.Width - shW) / 2);
        Canvas.SetTop(Shadow, feetY - shH * 0.35);
    }

    // ------------------------------------------------------------------ idle bob

    private void StartBob()
    {
        if (!AnimationEnabled || !IsLoaded || _timer is not null) return;
        _timer = new DispatcherTimer(DispatcherPriority.Render)
        {
            Interval = TimeSpan.FromMilliseconds(33)
        };
        _timer.Tick += (_, _) => TickBob();
        _timer.Start();
    }

    private void StopBob()
    {
        if (_timer is null) return;
        _timer.Stop();
        _timer = null;
        Bob.Y = 0;
    }

    private void TickBob()
    {
        double dpiY = VisualTreeHelper.GetDpi(this).DpiScaleY;
        double unitDips = 4.0 / dpiY;
        double phase = Environment.TickCount64 / 1600.0 * Math.PI;
        Bob.Y = -Math.Abs(Math.Sin(phase)) * Math.Max(1.0, unitDips * 0.7);
    }
}