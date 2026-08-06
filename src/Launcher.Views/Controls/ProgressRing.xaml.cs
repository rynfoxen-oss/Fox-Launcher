using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Animation;

namespace Launcher.Views.Controls;

/// <summary>Animated indeterminate progress ring.</summary>
public partial class ProgressRing : UserControl
{
    private Storyboard? _spin;

    public ProgressRing()
    {
        InitializeComponent();
    }

    public static readonly DependencyProperty SizeProperty =
        DependencyProperty.Register(nameof(Size), typeof(double), typeof(ProgressRing), new PropertyMetadata(28.0));

    public double Size
    {
        get => (double)GetValue(SizeProperty);
        set => SetValue(SizeProperty, value);
    }

    public static readonly DependencyProperty ThicknessProperty =
        DependencyProperty.Register(nameof(Thickness), typeof(double), typeof(ProgressRing), new PropertyMetadata(3.0));

    public double Thickness
    {
        get => (double)GetValue(ThicknessProperty);
        set => SetValue(ThicknessProperty, value);
    }

    [Browsable(false)]
    public System.Windows.Media.Color AccentColor { get; set; } = System.Windows.Media.Colors.Transparent;

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_spin is null)
        {
            _spin = (Storyboard)FindResource("Spin");
            _spin.Completed += (_, _) => _spin.Begin(this);
        }
        _spin.Begin(this);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e)
        => _spin?.Stop(this);
}
