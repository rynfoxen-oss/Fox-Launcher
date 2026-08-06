using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Launcher.Views.Controls;

/// <summary>Circular avatar with initials fallback. Renders async-safe on the UI thread.</summary>
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

    private static void OnSourceChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
        => ((AvatarImage)d).Refresh();

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

    private void ClipToCircle()
    {
        var ellipse = new EllipseGeometry { RadiusX = ActualWidth / 2, RadiusY = ActualHeight / 2, Center = new Point(ActualWidth / 2, ActualHeight / 2) };
        Photo.Clip = ellipse;
        Backdrop.Clip = ellipse;
        Initials.Clip = ellipse;
    }
}
