using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Imaging;

namespace Launcher.Views.Controls;

/// <summary>
/// Renders the head-front face of a Minecraft skin PNG as a small square
/// thumbnail, using the standard skin sheet layout (the head's front face lives
/// at (8,8)-(16,16) in 16px texture units).
/// </summary>
public partial class SkinThumbnail : UserControl
{
    public static readonly DependencyProperty SourcePathProperty =
        DependencyProperty.Register(nameof(SourcePath), typeof(string), typeof(SkinThumbnail),
            new PropertyMetadata("", (d, _) => ((SkinThumbnail)d).Refresh()));

    public string SourcePath
    {
        get => (string)GetValue(SourcePathProperty);
        set => SetValue(SourcePathProperty, value);
    }

    public SkinThumbnail()
    {
        InitializeComponent();
        Loaded += (_, _) => Refresh();
    }

    private void Refresh()
    {
        var path = SourcePath;
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            Face.Source = null;
            return;
        }

        try
        {
            using var fs = File.OpenRead(path);
            var decoder = BitmapDecoder.Create(fs, BitmapCreateOptions.IgnoreColorProfile, BitmapCacheOption.OnLoad);
            var frame = decoder.Frames[0];

            // Head front face on the skin sheet.
            int scale = frame.PixelWidth >= 128 ? 4 : 2;
            int size = 8 * scale;
            int x = 8 * scale;
            int y = 8 * scale;
            if (size <= 0 || x + size > frame.PixelWidth || y + size > frame.PixelHeight)
            {
                Face.Source = frame;
                return;
            }

            var crop = new CroppedBitmap(frame, new Int32Rect(x, y, size, size));
            crop.Freeze();
            Face.Source = crop;
        }
        catch
        {
            Face.Source = null;
        }
    }
}