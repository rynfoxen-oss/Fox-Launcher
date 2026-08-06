using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Launcher.Views.Controls;

/// <summary>Renders a Minecraft skin figure (head cube + body) from a skin texture PNG.</summary>
public partial class SkinViewer : UserControl
{
    public SkinViewer()
    {
        InitializeComponent();
        Loaded += (_, _) => Refresh();
        Unloaded += (_, _) => Unlock();
    }

    /// <summary>Default skin (MHF_Steve) bundled as a project resource so the preview
    /// works even without an internet connection.</summary>
    private const string DefaultSkinResource = "pack://application:,,,/Launcher.Views;component/Assets/skins/default_steve.png";

    public static readonly DependencyProperty TextureUrlProperty =
        DependencyProperty.Register(nameof(TextureUrl), typeof(string), typeof(SkinViewer),
            new PropertyMetadata("", (d, _) => ((SkinViewer)d).Refresh()));

    public string TextureUrl
    {
        get => (string)GetValue(TextureUrlProperty);
        set => SetValue(TextureUrlProperty, value);
    }

    public static readonly DependencyProperty ShowBodyProperty =
        DependencyProperty.Register(nameof(ShowBody), typeof(bool), typeof(SkinViewer),
            new PropertyMetadata(false, (d, _) => ((SkinViewer)d).Refresh()));

    public bool ShowBody
    {
        get => (bool)GetValue(ShowBodyProperty);
        set => SetValue(ShowBodyProperty, value);
    }

    public static readonly DependencyProperty HeadWidthProperty =
        DependencyProperty.Register(nameof(HeadWidth), typeof(double), typeof(SkinViewer),
            new PropertyMetadata(96.0, (d, _) => ((SkinViewer)d).Refresh()));

    public double HeadWidth
    {
        get => (double)GetValue(HeadWidthProperty);
        set => SetValue(HeadWidthProperty, value);
    }

    private BitmapSource? _bmp;
    private object _lock = new();

    private async void Refresh()
    {
        if (!IsLoaded) return;
        Unlock();
        Busy.Visibility = Visibility.Visible;

        var requested = TextureUrl;
        var url = string.IsNullOrWhiteSpace(requested) ? DefaultSkinResource : requested;
        var bmp = await TryLoadAsync(url);

        // A newer refresh started while we were loading (e.g. account switch) - drop the stale result.
        if (!string.Equals(TextureUrl, requested, StringComparison.Ordinal)) return;

        // Fall back to the default skin when the configured texture fails to load.
        if (bmp is null && !string.Equals(url, DefaultSkinResource, StringComparison.Ordinal))
        {
            bmp = await TryLoadAsync(DefaultSkinResource);
            if (!string.Equals(TextureUrl, requested, StringComparison.Ordinal)) return;
        }

        if (bmp is null)
        {
            Busy.Visibility = Visibility.Collapsed;
            return;
        }

        lock (_lock) _bmp = bmp;
        Render();
    }

    private static async Task<BitmapSource?> TryLoadAsync(string url)
    {
        try
        {
            var bytes = await LoadBytesAsync(url).ConfigureAwait(false);
            return bytes is { Length: > 0 } ? Load(bytes) : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Loads the texture from an embedded resource, a local file or an HTTP URL.</summary>
    private static async Task<byte[]?> LoadBytesAsync(string textureUrl)
    {
        if (Uri.TryCreate(textureUrl, UriKind.Absolute, out var uri))
        {
            if (uri.Scheme == "file")
            {
                return File.Exists(uri.LocalPath) ? await File.ReadAllBytesAsync(uri.LocalPath).ConfigureAwait(false) : null;
            }
            if (uri.Scheme == "pack")
            {
                try
                {
                    using var stream = Application.GetResourceStream(uri)?.Stream;
                    if (stream is null) return null;
                    using var ms = new MemoryStream();
                    await stream.CopyToAsync(ms).ConfigureAwait(false);
                    return ms.ToArray();
                }
                catch
                {
                    return null;
                }
            }
        }
        if (File.Exists(textureUrl))
        {
            return await File.ReadAllBytesAsync(textureUrl).ConfigureAwait(false);
        }
        var http = AppHost.Services!.Container.Resolve<Launcher.Network.Http>();
        return await http.GetBytesAsync(textureUrl).ConfigureAwait(false);
    }

    private static BitmapSource? Load(byte[] bytes)
    {
        try
        {
            using var ms = new MemoryStream(bytes);
            var src = new BitmapImage();
            src.BeginInit();
            src.CacheOption = BitmapCacheOption.OnLoad;
            src.StreamSource = ms;
            src.EndInit();
            src.Freeze();
            return src;
        }
        catch
        {
            return null;
        }
    }

    private void Render()
    {
        if (!IsLoaded) return;
        try
        {
            RenderCore();
        }
        catch (Exception ex)
        {
            // A malformed/unusual texture must never take down the app or the preview.
            try { Busy.Visibility = Visibility.Collapsed; } catch { /* UI may be torn down */ }
            try { AppHost.Services?.Log.Warn($"Skin preview render failed: {ex.Message}"); } catch { /* logging is best-effort */ }
        }
    }

    private void RenderCore()
    {
        BitmapSource? src;
        lock (_lock) src = _bmp;
        if (src is null) return;

        // Normalise to a 32-bit BGRA buffer so pixel reads below are always correct.
        BitmapSource tex = src.Format != PixelFormats.Pbgra32
            ? new FormatConvertedBitmap(src, PixelFormats.Pbgra32, null, 0)
            : src;

        int texW = tex.PixelWidth;
        int texH = tex.PixelHeight;
        if (texW <= 0 || texH <= 0)
        {
            Busy.Visibility = Visibility.Collapsed;
            return;
        }

        int[] srcPixels = new int[texW * texH];
        tex.CopyPixels(srcPixels, texW * 4, 0);
        bool InTex(int x, int y) => x >= 0 && y >= 0 && x < texW && y < texH;
        int Sample(int x, int y) => InTex(x, y) ? srcPixels[y * texW + x] : 0;
        bool IsOpaque(int c) => (c & 0xFF000000) != 0;
        int Shade(int c, float f)
        {
            int a = (c >> 24) & 0xFF, b = (c >> 16) & 0xFF, g = (c >> 8) & 0xFF, r = c & 0xFF;
            return (a << 24) | ((int)(b * f) << 16) | ((int)(g * f) << 8) | (int)(r * f);
        }

        // --- Figure layout (units = output pixels) ---
        bool isNewFormat = texW >= 64 && texH >= 64;
        bool hasBody = ShowBody && isNewFormat;
        bool isSlim = isNewFormat && !IsOpaque(Sample(47, 20)) && !IsOpaque(Sample(47, 24));

        // Choose the block size so the whole figure fits the control at 1:1 (crisp pixels),
        // capped so the head never exceeds the requested HeadWidth.
        double availW = ActualWidth - 24;
        double availH = ActualHeight - 24;
        int cellsW = hasBody ? 16 : 11;            // body 16 wide / head cube 11 wide
        int cellsH = hasBody ? 36 : 11;            // 3 depth + 8 face + 1 gap + 24 body
        int cell = 8;
        if (availW > 0 && availH > 0)
            cell = Math.Max(3, Math.Min((int)(availW / cellsW), (int)(availH / cellsH)));
        cell = Math.Min(cell, Math.Max(3, (int)(HeadWidth / 8.0)));

        int depth = cell * 3;                      // cube depth offset
        int face = 8 * cell;
        int gap = cell;
        int bodyW = 16 * cell;
        int bodyH = 24 * cell;
        int cubeW = face + depth;
        int figW = Math.Max(bodyW, cubeW);
        int figH = depth + face + gap + bodyH;

        int[] dst = new int[figW * figH];
        void Put(int dx, int dy, int color)
        {
            if (dx < 0 || dy < 0 || dx >= figW || dy >= figH) return;
            if (IsOpaque(color)) dst[dy * figW + dx] = color;
        }
        void FillCell(int ox, int oy, int color)
        {
            for (int py = 0; py < cell; py++)
            for (int px = 0; px < cell; px++)
                Put(ox + px, oy + py, color);
        }
        // Straight scaled region (front faces, body parts).
        void StampRect(int sx, int sy, int sw, int sh, int bx, int by, float shade = 1f)
        {
            for (int y = 0; y < sh; y++)
            for (int x = 0; x < sw; x++)
            {
                int c = Sample(sx + x, sy + y);
                if (!IsOpaque(c)) continue;
                if (shade < 1f) c = Shade(c, shade);
                FillCell(bx + x * cell, by + y * cell, c);
            }
        }
        // Top face: source row 0 = back edge, row sh-1 = front edge; sheared up and right.
        void StampTop(int sx, int sy, int sw, int sh, int bx, int by, float shade = 1f)
        {
            for (int y = 0; y < sh; y++)
            for (int x = 0; x < sw; x++)
            {
                int c = Sample(sx + x, sy + y);
                if (!IsOpaque(c)) continue;
                if (shade < 1f) c = Shade(c, shade);
                int back = sh - 1 - y;
                FillCell(bx + x * cell + (int)(back * depth / (float)sh), by - (int)(back * depth / (float)sh), c);
            }
        }
        // Right face: source column 0 = front edge, column sw-1 = back edge; sheared up and right.
        void StampRight(int sx, int sy, int sw, int sh, int bx, int by, float shade = 1f)
        {
            for (int y = 0; y < sh; y++)
            for (int x = 0; x < sw; x++)
            {
                int c = Sample(sx + x, sy + y);
                if (!IsOpaque(c)) continue;
                if (shade < 1f) c = Shade(c, shade);
                FillCell(bx + (int)(x * depth / (float)sw), by + y * cell - (int)(x * depth / (float)sw), c);
            }
        }

        int headX = (figW - cubeW) / 2;
        int frontTopY = depth;
        int frontRightX = headX + face;

        // Head cube - side/top faces first (they sit behind), front face last so it wins
        // on any edge overlap. The right face is shaded to give the cube depth.
        StampRight(0, 8, 8, 8, frontRightX, frontTopY, 0.82f);   // head right
        StampRight(32, 8, 8, 8, frontRightX, frontTopY, 0.82f);  // hat right
        StampTop(8, 0, 8, 8, headX, frontTopY, 1f);              // head top
        StampTop(40, 0, 8, 8, headX, frontTopY, 1f);             // hat top
        StampRect(8, 8, 8, 8, headX, frontTopY);                 // head front
        StampRect(40, 8, 8, 8, headX, frontTopY);                // hat front

        // --- Body (front view), only for modern 64x64 textures ---
        if (hasBody)
        {
            int armW = isSlim ? 3 : 4;
            int armShift = isSlim ? 0 : 1;
            int bodyX = (figW - bodyW) / 2;
            int bodyY = frontTopY + face + gap;
            StampRect(20, 20, 8, 12, bodyX + 4 * cell, bodyY);                            // chest (front)
            StampRect(44, 20, armW, 12, bodyX, bodyY);                                    // right arm (viewer left)
            StampRect(36, isNewFormat ? 52 : 20, armW, 12, bodyX + (12 + armShift) * cell, bodyY); // left arm (viewer right)
            StampRect(4, 20, 4, 12, bodyX + 4 * cell, bodyY + 12 * cell);                 // right leg (viewer left)
            StampRect(isNewFormat ? 20 : 20, isNewFormat ? 52 : 20, 4, 12, bodyX + 8 * cell, bodyY + 12 * cell); // left leg
        }

        var figureWb = new WriteableBitmap(figW, figH, 96, 96, PixelFormats.Pbgra32, null);
        figureWb.WritePixels(new Int32Rect(0, 0, figW, figH), dst, figW * 4, 0);

        // Display at native size (crisp). Shrink only if the box is unexpectedly smaller.
        double renderW = figW;
        double renderH = figH;
        if (availW > 0 && availH > 0)
        {
            double fit = Math.Min(availW / figW, availH / figH);
            if (fit < 1.0)
            {
                renderW = figW * fit;
                renderH = figH * fit;
            }
        }

        Figure.Width = renderW;
        Figure.Height = renderH;
        Figure.Fill = new ImageBrush(figureWb);

        Busy.Visibility = Visibility.Collapsed;
    }

    private void Unlock()
    {
        lock (_lock)
        {
            _bmp = null;
        }
    }
}
