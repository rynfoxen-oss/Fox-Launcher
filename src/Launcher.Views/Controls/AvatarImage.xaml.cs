using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Launcher.Skin;

namespace Launcher.Views.Controls;

/// <summary>
/// Circular avatar with initials fallback. Renders async-safe on the UI thread.
/// When <see cref="IsSkin"/> is set the source is treated as a full Minecraft
/// skin atlas and the head is composited (right + front + left faces with hat)
/// so the avatar immediately shows the account's applied skin.
/// </summary>
public partial class AvatarImage : UserControl
{
    public AvatarImage()
    {
        InitializeComponent();
        SizeChanged += (_, _) => ClipToCircle();
        Loaded += (_, _) => ClipToCircle();
    }

    public static readonly DependencyProperty ImageUrlProperty =
        DependencyProperty.Register(nameof(ImageUrl), typeof(string), typeof(AvatarImage),
            new PropertyMetadata("", OnSourceChanged));

    public string ImageUrl
    {
        get => (string)GetValue(ImageUrlProperty);
        set => SetValue(ImageUrlProperty, value);
    }

    public static readonly DependencyProperty DisplayNameProperty =
        DependencyProperty.Register(nameof(DisplayName), typeof(string), typeof(AvatarImage),
            new PropertyMetadata("", OnSourceChanged));

    public string DisplayName
    {
        get => (string)GetValue(DisplayNameProperty);
        set => SetValue(DisplayNameProperty, value);
    }

    /// <summary>
    /// Whether <see cref="ImageUrl"/> points at a Minecraft skin atlas (not an
    /// already-rendered portrait). The head is then drawn from the atlas.
    /// </summary>
    public static readonly DependencyProperty IsSkinProperty =
        DependencyProperty.Register(nameof(IsSkin), typeof(bool), typeof(AvatarImage),
            new PropertyMetadata(false, OnSourceChanged));

    public bool IsSkin
    {
        get => (bool)GetValue(IsSkinProperty);
        set => SetValue(IsSkinProperty, value);
    }

    private static void OnSourceChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
        => ((AvatarImage)d).Refresh();

    /// <summary>Reloads the source even when the URL is unchanged, e.g. after an
    /// offline re-apply overwrites the account's skin file in place.</summary>
    public void Reload() => Refresh();

    private void Refresh()
    {
        Initials.Text = DisplayName.Length > 0 ? DisplayName.Substring(0, 1).ToUpperInvariant() : "?";
        Photo.Visibility = Visibility.Collapsed;
        Initials.Visibility = Visibility.Visible;

        if (string.IsNullOrWhiteSpace(ImageUrl) || !Uri.TryCreate(ImageUrl, UriKind.Absolute, out var uri))
            return;

        if (uri.Scheme == "file")
        {
            TryLoad(uri.LocalPath);
            return;
        }

        System.Threading.Tasks.Task.Run(async () =>
        {
            try
            {
                var http = AppHost.Services!.Container.Resolve<Launcher.Network.Http>();
                var bytes = await http.GetBytesAsync(ImageUrl).ConfigureAwait(false);
                if (bytes is { Length: > 0 })
                    Dispatcher.Invoke(() => Apply(bytes));
            }
            catch
            {
                // fallback initials remain visible
            }
        });
    }

    private void TryLoad(string path)
    {
        if (!File.Exists(path)) return;
        try
        {
            Apply(File.ReadAllBytes(path));
        }
        catch
        {
            // ignore corrupt avatar
        }
    }

    private void Apply(byte[] bytes)
    {
        if (IsSkin && TryApplySkin(bytes)) return;
        ApplyImage(bytes);
    }

    private void ApplyImage(byte[] bytes)
    {
        try
        {
            using var ms = new MemoryStream(bytes);
            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.CacheOption = BitmapCacheOption.OnLoad;
            bmp.StreamSource = ms;
            bmp.EndInit();
            bmp.Freeze();
            Photo.Source = bmp;
            Photo.Visibility = Visibility.Visible;
            Initials.Visibility = Visibility.Collapsed;
        }
        catch
        {
            // keep initials
        }
    }

    /// <summary>
    /// Composites a classic Minecraft-style head profile (right + front + left
    /// faces with the hat overlay) onto a square canvas so <see cref="Photo"/>
    /// (UniformToFill) never crops it. Returns false when the bytes are not a
    /// readable skin atlas, so the caller falls back to plain rendering.
    /// </summary>
    private bool TryApplySkin(byte[] bytes)
    {
        try
        {
            var tex = PngDecoder.Decode(bytes);
            if (tex is null) return false;

            const int u = 4;            // native pixels per texture pixel
            const int headUnits = 8;    // the head block is 8x8 in the atlas
            int side = headUnits * 3 * u;          // 3 faces across -> square
            int y = headUnits * u;                 // ignore the top/bottom rows
            var buf = new byte[side * side * 4];

            // Base head, then the hat layer, in viewer order: right, front, left.
            Skin2DPreview.DrawFace(tex, SkinPart.Head, SkinLayer.Base, SkinFace.Right, false, u, 0, y, side, buf);
            Skin2DPreview.DrawFace(tex, SkinPart.Head, SkinLayer.Base, SkinFace.Front, false, u, headUnits, y, side, buf);
            Skin2DPreview.DrawFace(tex, SkinPart.Head, SkinLayer.Base, SkinFace.Left, false, u, headUnits * 2, y, side, buf);
            Skin2DPreview.DrawFace(tex, SkinPart.Head, SkinLayer.Overlay, SkinFace.Right, false, u, 0, y, side, buf);
            Skin2DPreview.DrawFace(tex, SkinPart.Head, SkinLayer.Overlay, SkinFace.Front, false, u, headUnits, y, side, buf);
            Skin2DPreview.DrawFace(tex, SkinPart.Head, SkinLayer.Overlay, SkinFace.Left, false, u, headUnits * 2, y, side, buf);

            Skin2DPreview.Premultiply(buf);

            var wb = new WriteableBitmap(side, side, 96, 96, PixelFormats.Pbgra32, null);
            wb.WritePixels(new Int32Rect(0, 0, side, side), buf, side * 4, 0);
            wb.Freeze();
            Photo.Source = wb;
            Photo.Visibility = Visibility.Visible;
            Initials.Visibility = Visibility.Collapsed;
            return true;
        }
        catch
        {
            return false;
        }
    }

    private void ClipToCircle()
    {
        var ellipse = new EllipseGeometry { RadiusX = ActualWidth / 2, RadiusY = ActualHeight / 2, Center = new Point(ActualWidth / 2, ActualHeight / 2) };
        Photo.Clip = ellipse;
        Backdrop.Clip = ellipse;
        Initials.Clip = ellipse;
    }
}
